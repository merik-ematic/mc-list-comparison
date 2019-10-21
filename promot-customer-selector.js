/* eslint-disable no-console */
const fs = require('fs');
const axios = require('axios');
const dotent = require('dotenv');
const prompts = require('prompts');
const mysqlssh = require('mysql-ssh');
const { Spinner } = require('cli-spinner');

dotent.config();

const makeMailChimpRequester = apikey => axios.create({
  auth: {
    username: 'none',
    password: apikey,
  },
  baseURL: `https://${apikey.split('-')[1]}.api.mailchimp.com/3.0/`,
});

module.exports = {
  searchTitle: (i, c) => {
    const q = i.toLowerCase();
    return Promise.resolve(i.length ? c.filter(data => data.title.toLowerCase().includes(q)) : c);
  },
  fetchCustomerFromDB: async () => {
    const spinner = new Spinner('Fetching customers...');
    spinner.start();
    const lists = [];

    const dbCon = await mysqlssh.connect(
      {
        port: process.env.SSH_PORT,
        host: process.env.SSH_HOST,
        user: process.env.SSH_USER,
        passphrase: process.env.SSH_KEY_PASS,
        privateKey: fs.readFileSync(process.env.SSH_KEY_FILE),
      },
      {
        port: process.env.SSH_DB_PORT,
        host: 'localhost',
        user: process.env.SSH_DB_USER,
        password: process.env.SSH_DB_PASS,
        database: process.env.SSH_DB_DB,
      },
    );

    const [results] = await dbCon.query('SELECT name, espAPIKey FROM `Accounts` WHERE active = 1 AND espName = "mailchimp"');

    results.forEach((item) => {
      lists.push({
        title: item.name,
        value: {
          name: item.name,
          apikey: item.espAPIKey,
        },
      });
    });

    mysqlssh.close();
    spinner.stop();

    return lists;
  },
  customerSelector: async skipConfirm => prompts([
    {
      type: 'autocomplete',
      name: 'customer',
      limit: 0,
      message: 'Which customer?',
      choices: module.exports.fetchCustomerFromDB,
      suggest: module.exports.searchTitle,
    },
    {
      type: 'autocomplete',
      name: 'list',
      message: 'Which list?',
      choices: async (prev) => {
        const spinner = new Spinner('Fetching lists...');
        spinner.start();
        const lists = [];

        let data;
        let status;

        try {
          const requester = makeMailChimpRequester(prev.apikey);
          const result = await requester.get('lists', {
            params: {
              fields: 'lists.id,lists.name',
              count: 1000,
            },
          });
          ({ data, status } = result);
        } catch (err) {
          console.error(err);
          process.exit();
        }

        if (status !== 200) {
          spinner.stop();
          console.error('Retriving lists failed...');
          process.exit(-1);
        }

        data.lists.forEach((list) => {
          lists.push({
            title: list.name,
            value: {
              id: list.id,
              name: list.name,
            },
          });
        });

        spinner.stop();

        return lists;
      },
      suggest: module.exports.searchTitle,
    },
    {
      type: skipConfirm ? null : 'confirm',
      name: 'isConfirm',
      message: (prev, values) => `Using "${values.customer.name} - ${values.list.name}", Can you confirm?`,
      initial: false,
    },
  ]),
  customerSelectorWithoutList: async skipConfirm => prompts([
    {
      type: 'autocomplete',
      name: 'customer',
      limit: 0,
      message: 'Which customer?',
      choices: module.exports.fetchCustomerFromDB,
      suggest: module.exports.searchTitle,
    },
    {
      type: skipConfirm ? null : 'confirm',
      name: 'isConfirm',
      message: (prev, values) => `Using "${values.customer.name}", Can you confirm?`,
      initial: false,
    },
  ]),
};
