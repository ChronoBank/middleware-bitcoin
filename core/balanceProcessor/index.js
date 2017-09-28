const config = require('../../config'),
  mongoose = require('mongoose'),
  fetchBalanceService = require('./fetchBalanceService'),
  fetchUTXOService = require('./fetchUTXOService'),
  fetchTXService = require('./fetchTXService'),
  accountModel = require('../../models/accountModel'),
  bunyan = require('bunyan'),
  _ = require('lodash'),
  log = bunyan.createLogger({name: 'core.balanceProcessor'}),
  amqp = require('amqplib');

/**
 * @module entry point
 * @description update balances for addresses, which were specified
 * in received transactions from blockParser via amqp
 */

mongoose.Promise = Promise;
mongoose.connect(config.mongo.uri, {useMongoClient: true});

let init = async () => {
  let conn = await amqp.connect(config.rabbit.url);
  let channel = await conn.createChannel();

  try {
    await channel.assertExchange('events', 'topic', {durable: false});
    await channel.assertQueue(`app_${config.rabbit.serviceName}.balance_processor.tx`);
    await channel.bindQueue(`app_${config.rabbit.serviceName}.balance_processor.tx`, 'events', `${config.rabbit.serviceName}_transaction.*`);
  } catch (e) {
    log.error(e);
    channel = await conn.createChannel();
  }

  try {
    await channel.assertQueue(`app_${config.rabbit.serviceName}.balance_processor.block`);
    await channel.bindQueue(`app_${config.rabbit.serviceName}.balance_processor.block`, 'events', `${config.rabbit.serviceName}_block`);
  } catch (e) {
    log.error(e);
    channel = await conn.createChannel();
  }

  channel.prefetch(2);

  channel.consume(`app_${config.rabbit.serviceName}.balance_processor.block`, async data => {
    try {
      let payload = JSON.parse(data.content.toString());
      let accounts = await accountModel.find({
        $where: 'obj.balances && !(obj.balances.confirmations0 === obj.balances.confirmations3 && ' +
        'obj.balances.confirmations3 ===  obj.balances.confirmations6)',
        lastBlockCheck: {$lt: payload.block}
      });

      for (let account of accounts) {
        let balances = await fetchBalanceService(account.address);

        account.lastTxs = _.filter(account.lastTxs, item => {
          let heightDiff = payload.block - item.block;
          return heightDiff === 0 || heightDiff === 3 || heightDiff === 6;
        });

        for (let i = 0; i < account.lastTxs.length; i++) {
          let txHash = account.lastTxs[i];
          let tx = await fetchTXService(txHash);

          for (let i = 0; i < tx.inputs.length; i++) {
            let txOut = await fetchTXService(tx.inputs[i].prevout.hash);
            tx.inputs[i] = txOut.outputs[tx.inputs[i].prevout.index];
          }

          tx.valueIn = _.chain(tx.inputs)
            .map(i => i.value)
            .sum()
            .value();

          tx.valueOut = _.chain(tx.outputs)
            .map(i => i.value)
            .sum()
            .value();

          tx.fee = tx.valueIn - tx.valueOut;

          console.log({
            address: account.address,
            balances: balances.balances,
            tx: tx
          });

          channel.publish('events', `${config.rabbit.serviceName}_balance.${payload.address}`, new Buffer(JSON.stringify({
            address: payload.address,
            balances: balances.balances,
            tx: tx
          })));

        }

        await accountModel.update({address: account.address, lastBlockCheck: {$lt: payload.block}}, {
            $set: {
              'balances.confirmations0': balances.balances.confirmations0,
              'balances.confirmations3': balances.balances.confirmations3,
              'balances.confirmations6': balances.balances.confirmations6,
              lastBlockCheck: payload.block,
              lastTxs: _.filter(account.lastTxs, item => payload.block - item.block <= 6)
            }
          }
        );
      }

    } catch (e) {
      log.error(e);
    }

    // channel.ack(data);
  });

  channel.consume(`app_${config.rabbit.serviceName}.balance_processor.tx`, async (data) => {
    try {
      let payload = JSON.parse(data.content.toString());
      let balances = await fetchBalanceService(payload.address);
      await accountModel.update({address: payload.address, lastBlockCheck: {$lt: balances.lastBlockCheck}}, {
          $set: {
            'balances.confirmations0': balances.balances.confirmations0,
            'balances.confirmations3': balances.balances.confirmations3,
            'balances.confirmations6': balances.balances.confirmations6,
            lastBlockCheck: balances.lastBlockCheck,
          },
          $push: {
            lastTxs: {
              $each: payload.txs.map(tx => ({txid: tx, blockHeight: payload.block}))
            }
          }
        }
      );

      for (let txHash of payload.txs) {
        let tx = await fetchTXService(txHash);

        for (let i = 0; i < tx.inputs.length; i++) {
          let txOut = await fetchTXService(tx.inputs[i].prevout.hash);
          tx.inputs[i] = txOut.outputs[tx.inputs[i].prevout.index];
        }

        tx.valueIn = _.chain(tx.inputs)
          .map(i => i.value)
          .sum()
          .value();

        tx.valueOut = _.chain(tx.outputs)
          .map(i => i.value)
          .sum()
          .value();

        tx.fee = tx.valueIn - tx.valueOut;

        channel.publish('events', `${config.rabbit.serviceName}_balance.${payload.address}`, new Buffer(JSON.stringify({
          address: payload.address,
          balances: balances.balances,
          tx: tx
        })));

      }

      log.info(`balance updated for ${payload.address}`);
    } catch (e) {
      log.error(e);
    }
    channel.ack(data);
  });

};

module.exports = init();
