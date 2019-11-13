/* eslint-disable no-console */
const fs = require('fs');
const rp = require('request-promise');
const path = require('path');
const Loki = require('lokijs');
const axios = require('axios');
const parse = require('csv-parse');
const crypto = require('crypto');
const dotent = require('dotenv');
const ndjson = require('ndjson');
const request = require('request');
const cheerio = require('cheerio');
const prompts = require('prompts');
const readline = require('readline');
const stripBom = require('strip-bom');
const validator = require('validator');
const removeBOM = require('remove-bom-stream');
const emailParser = require('email-addresses');
const { Parser } = require('json2csv');
const {
  waterfall,
  each,
  doUntil,
  parallel,
} = require('async');
// const { customerSelector } = require('./promot-customer-selector-manually');
const { customerSelector } = require('./promot-customer-selector');

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
const hostDb = new Loki('ematic-blacklist-domain.db');
const emailDb = db.addCollection('emails', {
  unique: ['email'],
  autoupdate: true,
});
const exportDb = db.addCollection('exports', {
  unique: ['email'],
  indices: ['subscriberStatusByEmaticTool'],
  autoupdate: true,
});

const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));

const cookieJar = rp.jar();

let blackHostDb;

waterfall([
  (cb) => {
    hostDb.loadDatabase({}, () => {
      blackHostDb = hostDb.getCollection('hosts');
      if (blackHostDb === null) {
        console.log('No blacklist host');
        blackHostDb = hostDb.addCollection('hosts', {
          unique: ['host'],
          autoupdate: true,
        });
      }
      cb();
    });
  },
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
      columns = stripBom(line).split(',');
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
    endpointUrl.searchParams.set('hashed', 'sha256');
    endpointUrl.searchParams.set('apikey', apikey);
    endpointUrl.searchParams.set('id', listId);
    cb(null, endpointUrl, emailField);
  },
  (url, emailField, cb) => {
    each(statusList, (status, eachCb) => {
      const hrstartTs = process.hrtime();
      url.searchParams.set('status', status);
      const endpoint = url.toString();
      console.info(`✔ Importing status: ${status} users into memory DB`);
      request.get(endpoint)
        .pipe(ndjson.parse())
        .on('data', ([email]) => {
          if (email === 'Email Address') { return; }
          if (email === 'EMAIL_HASH') { return; }
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
        if (typeof email === 'undefined') {
          console.log('X There\'s something wrong when parse the file... Please contact Merik to solve this.', data, emailField);
          process.exit(-1);
        }
        const loweredEmail = email.toLowerCase();
        const result = emailDb.by('email', crypto.createHash('sha256').update(loweredEmail).digest('hex'));
        const exists = exportDb.by('email', email);
        if (result) {
          // eslint-disable-next-line no-param-reassign
          data.subscriberStatusByEmaticTool = result.status;
        } else {
          let status = validator.isEmail(email) ? 'new' : 'fail';
          if (status === 'new') {
            const { domain } = emailParser.parseOneAddress(email);
            if (blackHostDb.by('host', domain)) {
              status = 'blacklist';
            }
          }
          // eslint-disable-next-line no-param-reassign
          data.subscriberStatusByEmaticTool = status;
        }
        if (exists) {
          exists.subscriberStatusByEmaticTool = data.subscriberStatusByEmaticTool;
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
    filterStatus.push('new', 'fail', 'blacklist');
    const parser = new Parser();
    each(filterStatus, (subscriberStatus, eachCb) => {
      const query = { subscriberStatusByEmaticTool: subscriberStatus };
      const records = exportDb.chain().find(query).data({ removeMeta: true });
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
  (emailField, newFilePath, cb) => {
    waterfall([
      async () => {
        const dom = await rp({
          url: 'https://cse.ematicsolutions.com/login',
          jar: cookieJar,
          transform: (body) => cheerio.load(body),
        });
        return dom('input[name="_token"]').attr('value');
      },
      async (token) => {
        const loggedRsp = await rp({
          resolveWithFullResponse: true,
          followAllRedirects: true,
          method: 'POST',
          jar: cookieJar,
          uri: 'https://cse.ematicsolutions.com/login',
          form: {
            _token: token,
            email: process.env.CSE_TOOL_USERNAME,
            password: process.env.CSE_TOOL_PASSWORD,
          },
        });
        const isLogged = loggedRsp.request.uri.href === 'https://cse.ematicsolutions.com/';
        console.log(`✔ CSE tool login ${isLogged ? 'succeeded' : 'failed'}`);
        if (!isLogged) throw new Error('CSE tool login failed');
      },
      async () => {
        const loggedDom = await rp({
          url: 'https://cse.ematicsolutions.com/cleaned-emails-scan/create',
          jar: cookieJar,
          transform: (body) => cheerio.load(body),
        });
        return loggedDom('input[name="_token"]').attr('value');
      },
      async (cesToken) => {
        const formData = {
          csv_file: fs.createReadStream(newFilePath),
          _token: cesToken,
          email_column_ordinal: emailField.index + 1,
          header_row: 1,
        };
        const cesRsp = await rp({
          resolveWithFullResponse: true,
          followAllRedirects: true,
          method: 'POST',
          jar: cookieJar,
          uri: 'https://cse.ematicsolutions.com/cleaned-emails-scan',
          formData,
        });

        console.log(`✔ CSE cleaned emails scan created: ${cesRsp.request.uri.href}`);

        return cesRsp.request.uri.href;
      },
      (taskUrl, wcb) => {
        doUntil(async () => {
          const data = await rp({
            jar: cookieJar,
            uri: `${taskUrl}/status`,
            json: true,
          });
          process.stdout.clearLine();
          process.stdout.cursorTo(0);
          process.stdout.write(`✔ Clean processed: ${data.progress}%...`);
          await sleep(3000);
          return data;
        }, (data) => parseInt(data.progress, 10) >= 100, (e) => process.stdout.write('\n') && wcb(e, taskUrl));
      },
      (taskUrl, wcb) => {
        const cleanUrl = `${taskUrl}/download/output`;
        const cleanedUrl = `${taskUrl}/download/cleaned`;
        console.log('✔ Clean finished, downloading results...');
        parallel([
          async () => {
            const cleanData = await rp({
              jar: cookieJar,
              uri: cleanUrl,
            });
            return cleanData;
          },
          async () => {
            const cleanedData = await rp({
              jar: cookieJar,
              uri: cleanedUrl,
            });
            return cleanedData;
          },
        // eslint-disable-next-line no-shadow
        ], (e, [cleanData, cleanedData]) => {
          if (e) wcb(e);
          const cleanFileName = path.basename(newFilePath, path.extname(newFilePath));
          const cleanFileLocation = path.dirname(newFilePath);
          fs.writeFileSync(`${cleanFileLocation}/${cleanFileName}_out.csv`, cleanData);
          fs.writeFileSync(`${cleanFileLocation}/${cleanFileName}_cleaned.csv`, cleanedData);
          // eslint-disable-next-line no-param-reassign
          newFilePath = `${cleanFileLocation}/${cleanFileName}_out.csv`;
          console.log('✔ Clean results downloaded.');
          wcb();
        });
      },
    ], (e) => cb(e, emailField, newFilePath));
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
    }, (status) => status.type === 'PRE_VALIDATED' && status.percent >= 100, (e) => process.stdout.write('\n') && cb(e, data));
  },
  (dvResult, cb) => {
    console.log('✔ DV Finished, ');
    const overallScore = dvResult.current_score;
    const totalCount = dvResult.subscriber_count;
    const uniqueCount = dvResult.distinct_subscriber_count;
    const gradeAA = dvResult.grade_summary['A+'];
    const gradeA = dvResult.grade_summary.A;
    const gradeB = dvResult.grade_summary.B;
    const gradeD = dvResult.grade_summary.D;
    const gradeF = dvResult.grade_summary.F;
    const percent = (grade) => ((grade / uniqueCount) * 100).toPrecision(4);
    console.log(`✔ The score is: ${overallScore.toPrecision(4)} and ${totalCount} <=> ${uniqueCount} count.`);
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
  if (e) throw e;
});
