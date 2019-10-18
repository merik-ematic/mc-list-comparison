/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const Loki = require('lokijs');
const parse = require('csv-parse');
const ndjson = require('ndjson');
const request = require('request');
const validator = require('validator');
const { Parser } = require('json2csv');
const { waterfall, each } = require('async');
const { customerSelector } = require('./promot-customer-selector');

const filePath = process.argv[2];

if (typeof filePath === 'undefined') {
  console.error('no input file');
  process.exit(-1);
}

const fileName = path.basename(filePath, path.extname(filePath));
const fileLocation = path.dirname(filePath);

const statusList = ['subscribed', 'unsubscribed', 'cleaned'].reverse();

const db = new Loki('mc-export-stream.db');
const emailDb = db.addCollection('emails', {
  unique: ['email'],
  autoupdate: true,
});
const exportDb = db.addCollection('exports', {
  unique: ['email'],
  indices: ['subscriberStatus'],
  autoupdate: true,
});

waterfall([
  async () => {
    const clientData = await customerSelector();

    if (clientData.isConfirm !== true) {
      console.log('Bye.');
      process.exit();
    }

    const endpoint = `https://${clientData.customer.apikey.split('-')[1]}.api.mailchimp.com/export/1.0/list/`;

    return {
      apikey: clientData.customer.apikey,
      listId: clientData.list.id,
      endpoint,
    };
  },
  ({ apikey, listId, endpoint }, cb) => {
    const endpointUrl = new URL(endpoint);
    endpointUrl.searchParams.set('apikey', apikey);
    endpointUrl.searchParams.set('id', listId);
    cb(null, endpointUrl);
  },
  (url, cb) => {
    each(statusList, (status, eachCb) => {
      const hrstartTs = process.hrtime();
      url.searchParams.set('status', status);
      const endpoint = url.toString();
      console.info(`✔ Importing status: ${status} => ${endpoint}`);
      request.get(endpoint)
        .pipe(ndjson.parse())
        .on('data', ([email]) => {
          if (email === 'Email Address') { return; }
          emailDb.insert({ email, status });
        })
        .on('end', () => {
          const hrendTs = process.hrtime(hrstartTs);
          console.info(`✔ Done import for status: ${status}, Execution time (hr): %ds %dms`, hrendTs[0], hrendTs[1] / 1000000);
          eachCb();
        })
        .on('error', (e) => {
          console.info(`✖️ Failed import for status: ${status}`);
          eachCb(e);
        });
    }, (e) => {
      cb(e);
    });
  },
  (cb) => {
    console.log('✔ Parsing csv file & load into memory db...');
    const hrstartTs = process.hrtime();
    fs.createReadStream(filePath)
      .pipe(parse({ skip_empty_lines: true, columns: true, trim: true }))
      .on('data', (data) => {
        const { email } = data;
        const result = emailDb.by('email', email);
        const exists = exportDb.by('email', email);
        if (result) {
          // eslint-disable-next-line no-param-reassign
          data.subscriberStatus = result.status;
        } else {
          // eslint-disable-next-line no-param-reassign
          data.subscriberStatus = validator.isEmail(email) ? 'new' : 'fail';
        }
        if (exists) {
          exists.subscriberStatus = data.subscriberStatus;
        } else {
          exportDb.insert(data);
        }
      })
      .on('error', (e) => {
        cb(e);
      })
      .on('end', () => {
        const hrendTs = process.hrtime(hrstartTs);
        console.info('✔ DB insert Execution time (hr): %ds %dms', hrendTs[0], hrendTs[1] / 1000000);
        cb(null);
      });
  },
  (cb) => {
    const filterStatus = JSON.parse(JSON.stringify(statusList));
    console.info('✔ Exporting csv');
    filterStatus.push('new', 'fail');
    const parser = new Parser();
    each(filterStatus, (subscriberStatus, eachCb) => {
      const savedFile = `${fileLocation}/${fileName}_${subscriberStatus}_results.csv`;
      const records = exportDb.chain().find({ subscriberStatus }).data({ removeMeta: true });
      fs.writeFile(savedFile, parser.parse(records), (e) => {
        eachCb(e);
      });
    }, e => cb(e));
  },
], (e) => {
  if (e) throw e;
});
