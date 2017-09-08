require('dotenv').config();
const _ = require('lodash');

/**
 * @factory config
 * @description base app's configuration
 * @returns {{
 *    mongo: {
 *      uri: (*)
 *      },
 *    rest: {
 *      domain: (*),
 *      port: (*)
 *      },
 *    rabbit: {
 *      url: (*)
 *      },
 *    bitcoin: {
 *      host: (*),
 *      port: (*),
 *      user: (*),
 *      pass: (*)
 *      }
 *    }}
 */

module.exports = {
  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/data'
  },
  rest: {
    domain: process.env.DOMAIN || 'localhost',
    port: parseInt(process.env.REST_PORT) || 8081
  },
  rabbit: {
    url: process.env.RABBIT_URI || 'amqp://localhost:5672'
  },
  bitcoin: {
    dbpath: process.env.BITCOIN_DB_PATH || '',
    network: process.env.BITCOIN_NETWORK || 'main',
    db: process.env.BITCOIN_DB || 'memory',
    ipcName: process.env.BITCOIN_IPC || 'bitcoin',
    coinbase: _.chain(process.env.BITCOIN_ETHERBASE || '')
      .split(',')
      .map(i => i.trim())
      .value()
  }
};
