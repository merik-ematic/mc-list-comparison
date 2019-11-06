/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const Loki = require('lokijs');
const axios = require('axios');
const parse = require('csv-parse');
const dotent = require('dotenv');
const ndjson = require('ndjson');
const request = require('request');
const prompts = require('prompts');
const readline = require('readline');
const validator = require('validator');
const removeBOM = require('remove-bom-stream');
const { Parser } = require('json2csv');
const { waterfall, each, doUntil } = require('async');
const { customerSelector } = require('./promot-customer-selector');
// const { customerSelector } = require('./promot-customer-selector-manually');

const filePath = process.argv[2];
const fileName = path.basename(filePath, path.extname(filePath));
const fileLocation = path.dirname(filePath);

dotent.config();

if (typeof filePath === 'undefined') {
  console.error('no input file');
  process.exit(-1);
}

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

const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));

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
  (api, cb) => {
    const rl = readline.createInterface(fs.createReadStream(filePath));
    let columns = [];
    rl.on('line', (line) => {
      columns = line.split(',');
      rl.close();
    });
    rl.on('close', async () => {
      const { emailIndex } = await prompts([
        {
          type: 'select',
          name: 'emailIndex',
          message: 'Which contains Email field?',
          choices: () => {
            const payload = [];
            columns.forEach((title, index) => {
              const escapedTitle = title.replace('"', '').replace('"', '');
              payload.push({ title: escapedTitle, value: { name: escapedTitle, index } });
            });
            return payload;
          },
        },
      ]);
      cb(null, api, emailIndex);
    });
  },
  ({ apikey, listId, endpoint }, emailField, cb) => {
    const endpointUrl = new URL(endpoint);
    endpointUrl.searchParams.set('apikey', apikey);
    endpointUrl.searchParams.set('id', listId);
    cb(null, endpointUrl, emailField);
  },
  (url, emailField, cb) => {
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
      cb(e, emailField);
    });
  },
  (emailField, cb) => {
    console.log('✔ Parsing csv file & load into memory db...');
    const hrstartTs = process.hrtime();
    fs.createReadStream(filePath)
      .pipe(removeBOM())
      .pipe(parse({ skip_empty_lines: true, columns: true, trim: true }))
      .on('data', (data) => {
        const email = data[emailField.name];
        const loweredEmail = email.toLowerCase();
        const result = emailDb.by('email', loweredEmail);
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
        cb(null, emailField);
      });
  },
  (emailField, cb) => {
    let newFilePath = '';
    const filterStatus = JSON.parse(JSON.stringify(statusList));
    console.info('✔ Exporting csv');
    filterStatus.push('new', 'fail');
    const parser = new Parser();
    each(filterStatus, (subscriberStatus, eachCb) => {
      const records = exportDb.chain().find({ subscriberStatus }).data({ removeMeta: true });
      if (records.length) {
        const savedFile = `${fileLocation}/${fileName}_${subscriberStatus}_results.csv`;
        fs.writeFile(savedFile, parser.parse(records), (e) => {
          eachCb(e);
        });
        console.log(`✔ Exporting records in ${subscriberStatus} to csv`);
        if (subscriberStatus === 'new') newFilePath = savedFile;
      } else {
        console.log(`✔ There's no records in ${subscriberStatus}`);
        eachCb();
      }
    }, (e) => cb(e, emailField, newFilePath));
  },
  async (emailField, newFilePath) => {
    console.log('✔ Preparing DV the new subs...');
    const dvFileName = path.basename(newFilePath, path.extname(newFilePath));
    const dvApiInstence = axios.create({
      baseURL: `https://${process.env.DV_DC}.datavalidation.com/api/v2/user/me/list/`,
      headers: {
        Authorization: `bearer ${process.env.DV_TOKEN}`,
      },
    });
    const rsp = await dvApiInstence.get('create_upload_url', {
      params: {
        name: dvFileName,
        email_column_index: emailField.index,
        has_header: 1,
        start_validation: 'false',
      },
    });

    return {
      dvApiInstence,
      dvFilePath: newFilePath,
      dvUrl: rsp.data,
    };
  },
  (config, cb) => {
    const { dvApiInstence, dvFilePath, dvUrl } = config;
    console.log('✔ Uploading file to DV server...');
    const formData = { file: fs.createReadStream(dvFilePath) };
    const payload = { url: dvUrl, formData, auth: { bearer: process.env.DV_TOKEN } };

    request.post(payload, (err, rsp, body) => {
      cb(err, {
        dvApiInstence,
        listId: JSON.parse(body),
      });
    });
  },
  (config, cb) => {
    const { dvApiInstence, listId } = config;
    console.log('✔ Start DV the new subs...');
    let data;
    doUntil(async () => {
      ({ data } = await dvApiInstence.get(listId));
      process.stdout.clearLine();
      process.stdout.cursorTo(0);
      process.stdout.write(`✔ DV stats: ${data.status_value} - ${data.status_percent_complete}%...`);
      await sleep(3000);
      return {
        type: data.status_value,
        percent: data.status_percent_complete,
      };
    }, (status) => status.type === 'PRE_VALIDATED' && status.percent >= 100, (e) => cb(e, data));
  },
  (dvResult, cb) => {
    const overallScore = dvResult.current_score;
    const totalCount = dvResult.subscriber_count;
    const uniqueCount = dvResult.distinct_subscriber_count;
    const gradeAA = dvResult.grade_summary['A+'];
    const gradeA = dvResult.grade_summary.A;
    const gradeB = dvResult.grade_summary.B;
    const gradeD = dvResult.grade_summary.D;
    const gradeF = dvResult.grade_summary.F;
    const percent = (grade) => ((grade / uniqueCount) * 100).toPrecision(4);
    console.log(`✔ DV Finished, the score is: ${overallScore.toPrecision(4)} and ${totalCount} <=> ${uniqueCount} count.`);
    console.log('✔ The grade summary is:');
    console.info({
      AA: `${percent(gradeAA)}%`,
      A: `${percent(gradeA)}%`,
      B: `${percent(gradeB)}%`,
      D: `${percent(gradeD)}%`,
      F: `${percent(gradeF)}%`,
    });
    cb();
  },
], (e) => {
  if (e) {
    console.log('errored');
    throw e;
  }
});
