/* eslint-disable no-console */

const _ = require('lodash');
const axios = require('axios');
const prompts = require('prompts');
const { Spinner } = require('cli-spinner');

const selectable = [
  {
    title: 'Account name here',
    value: {
      apikey: 'apikey here',
    },
  }, // Account name here
];

selectable.forEach((item) => {
  // eslint-disable-next-line no-param-reassign
  item.value.name = item.title;
});

const makeMailChimpRequester = (apikey) => axios.create({
  auth: {
    username: 'none',
    password: apikey,
  },
  baseURL: `https://${apikey.split('-')[1]}.api.mailchimp.com/3.0/`,
});

module.exports = {
  searchTitle: (i, c) => {
    const q = i.toLowerCase();
    return Promise.resolve(i.length ? c.filter((data) => data.title.toLowerCase().includes(q)) : c);
  },
  customerSelector: async (skipConfirm) => prompts([
    {
      type: 'autocomplete',
      name: 'customer',
      limit: 0,
      message: 'Which customer?',
      choices: selectable,
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

        _.each(data.lists, (list) => {
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
  customerSelectorWithoutList: async (skipConfirm) => prompts([
    {
      type: 'autocomplete',
      name: 'customer',
      limit: 0,
      message: 'Which customer?',
      choices: selectable,
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
