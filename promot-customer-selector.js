/* eslint-disable no-console */
const axios = require('axios');
const dotent = require('dotenv');
const prompts = require('prompts');
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
  fetchCustomerFromAPI: async () => {
    const spinner = new Spinner('Fetching customers...');
    spinner.start();
    const lists = [];

    const { data } = await axios.get(`${process.env.HI_IQ_V2_API_URL}/account`, {
      headers: {
        Authorization: `ematic-admin-apikey=${process.env.HI_IQ_V2_API_KEY}`,
      },
    });

    const accounts = data.account.filter(account => (account.espId === 1) && account.active);

    accounts.forEach((item) => {
      lists.push({
        title: item.name,
        value: {
          name: item.name,
          apikey: item.espAPIKey,
        },
      });
    });

    // mysqlssh.close();
    spinner.stop();

    return lists;
  },
  customerSelector: async skipConfirm => prompts([
    {
      type: 'autocomplete',
      name: 'customer',
      limit: 0,
      message: 'Which customer?',
      choices: module.exports.fetchCustomerFromAPI,
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
      choices: module.exports.fetchCustomerFromAPI,
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
