// Copyright © 2023 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';

const express = require('express');
const jsonBodyParser = require('body-parser').json();
const cors = require('cors');
const app = express();
const apiRouter = new express.Router();
const randomstring = require('randomstring');

const { HDWallet } = require('./lib/keystore/hdwallet');
const ShieldedWallet = require('./lib/keystore/shielded');
const TradeManager = require('./lib/trade-manager');
const WalletManager = require('./lib/wallet-manager');
const { HttpError, getLogger, isEthereumAddress, isShieldedAddress } = require('./lib/utils');
const Config = require('./lib/config');

// the users wallet dispenses new Ethereum signing accounts to assign to app users
const usersWallet = new HDWallet('users');
// the shielded wallet manages the ElGamal private keys on disk
const shieldedWallet = new ShieldedWallet();
// the wallet manager manages the various Ethereum wallets
const walletManager = new WalletManager();
// the trade manager manages interactions with the cash token and anonymous zether token contracts
const tradeManager = new TradeManager(walletManager, shieldedWallet);

const logger = getLogger();

const PORT = 3000;

function contentType(req, res, next) {
  if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') && !req.is('application/json') && !(req.headers && req.headers['kaleido-custom-content-type'] === 'true')) {
    res.status(400);
    res.send({ message: 'Invalid content type' });
  } else {
    next();
  }
}

function requestLogger(req, res, next) {
  // Intercept end to do logging
  const _end = res.end.bind(res);
  const requestId = newRequestId();
  const start = Date.now();
  logger.info(`--> ${requestId} ${req.method} ${req.path}`);
  res.end = (data, encoding) => {
    logger.info(`<-- ${requestId} ${req.method} ${req.path} [${res.statusCode}] (time=${Date.now() - start}ms)`);
    _end(data, encoding);
  };
  next();
}

function newRequestId() {
  return randomstring.generate({
    length: 10,
    charset: 'alphanumeric',
    capitalization: 'lowercase',
  });
}

function errorHandler(err, req, res) {
  // eslint-disable-line

  // This is always logged - even when KALEIDO_SERVICE_CONTAINER is true
  logger.error(`${req.method} ${req.url} - request failed`, err);

  if (err instanceof HttpError) {
    err.send(res, req.headers['x-request-id']);
  } else {
    res.status(500);
    res.send({
      requestId: req.headers['x-request-id'],
      errorMessage: 'Internal error',
    });
  }
}

function expressify(promiseFunc, responderFunc) {
  return (req, res, next) => {
    logger.info(req.path, req.method);
    promiseFunc(req, res)
      .then((responseBody) => {
        responderFunc(req, res, responseBody);
      })
      .catch((err) => {
        next(err);
      });
  };
}

// the /api/v1 endpoints will be protected by basic auth with app credentials
// enforced at the nginx
app.use('/api/v1', contentType, cors(), jsonBodyParser, requestLogger, apiRouter);

apiRouter.get(
  '/accounts',
  expressify(async () => {
    return await shieldedWallet.getAccounts();
  }, getHandler)
);

apiRouter.post(
  '/accounts',
  expressify(async () => {
    const ethAccount = await walletManager.newAccount('users');
    await tradeManager.enableRealDigitalAccount(ethAccount.address);
    const shieldedAccount = await shieldedWallet.createAccount(ethAccount.address);
    await tradeManager.zetherTokenClient.registerAccount(ethAccount.address);
    return { eth: ethAccount.address, shielded: shieldedAccount };
  }, postHandler)
);

apiRouter.post(
  '/mint',
  expressify(async (req) => {
    const { ethAddress, amount } = req.body;
    if (!ethAddress) {
      throw new HttpError('Must provide "ethAddress" for the signing address to draw fund from', 400);
    }
    if (!amount) {
      throw new HttpError('Must provide "amount" for the funding amount', 400);
    }
    const txHash = await tradeManager.cashTokenClient.mint(ethAddress, amount);
    return {
      success: true,
      transactionHash: txHash,
    };
  }, postHandler)
);

apiRouter.post(
  '/fund',
  expressify(async (req) => {
    const { ethAddress, amount } = req.body;
    if (!ethAddress) {
      throw new HttpError('Must provide "ethAddress" for the signing address to draw fund from', 400);
    }
    if (!amount) {
      throw new HttpError('Must provide "amount" for the funding amount', 400);
    }
    const txHash = await tradeManager.zetherTokenClient.fundAccount(ethAddress, amount);
    return {
      success: true,
      transactionHash: txHash,
    };
  }, postHandler)
);

apiRouter.post(
  '/transfer',
  expressify(async (req) => {
    const { sender, receiver, amount } = req.body;
    if (!isShieldedAddress(sender)) {
      throw new HttpError('Must provide "sender" in shielded address format for the sender address', 400);
    }
    if (!isShieldedAddress(receiver)) {
      throw new HttpError('Must provide "receiver" in shielded address format for the receiver address', 400);
    }
    const shieldedSenderAddress = sender.split(',');
    const shieldedReceiverAddress = receiver.split(',');
    if (!amount) {
      throw new HttpError('Must provide "amount" for the transfer amount', 400);
    }
    const txHash = await tradeManager.zetherTokenClient.transfer(shieldedSenderAddress, shieldedReceiverAddress, amount);
    return {
      success: true,
      transactionHash: txHash,
    };
  }, postHandler)
);

apiRouter.post(
  '/withdraw',
  expressify(async (req) => {
    const { ethAddress, amount } = req.body;
    if (!isEthereumAddress(ethAddress)) {
      throw new HttpError('Must provide the "ethAddress" for the ethereum address to withdraw funds to', 400);
    }
    if (!amount) {
      throw new HttpError('Must provide "amount" for the withdraw amount', 400);
    }
    const txHash = await tradeManager.zetherTokenClient.withdraw(ethAddress, amount);
    return {
      success: true,
      transactionHash: txHash,
    };
  }, postHandler)
);

apiRouter.get(
  '/accounts/:address/balance',
  expressify(async (req) => {
    const address = req.params.address;
    let balance;
    if (isEthereumAddress(address)) {
      // query for the ERC20 balance
      balance = await tradeManager.cashTokenClient.getERC20Balance(address);
    } else if (isShieldedAddress(address)) {
      // query for the Zether balance
      const shieldedAddress = address.split(',');
      balance = await tradeManager.zetherTokenClient.getBalance(shieldedAddress);
    } else {
      throw new HttpError('Unknown address format', 400);
    }
    return { balance };
  }, getHandler)
);

apiRouter.use(errorHandler);

function postHandler(req, res, result) {
  // eslint-disable-line no-unused-vars
  res.status(201);
  res.header('Content-Type', 'application/json');
  res.send(JSON.stringify({ ...result }, null, 2));
}

function getHandler(req, res, result) {
  res.status(200);
  res.header('Content-Type', 'application/json');
  res.send(JSON.stringify(result, null, 2));
}

function printConfig() {
  logger.info('Configurations:');
  logger.info(`\t    data dir: ${Config.getDataDir()}`);
  logger.info(`\t     eth URL: ${Config.getEthUrl()}`);
  logger.info(`\t    chain ID: ${Config.getChainId()}`);
  logger.info(`\t       erc20: ${Config.getERC20Address()}`);
  logger.info(`\t         ZSC: ${Config.getZSCAddress()}`);
  logger.info(`\tepoch length: ${Config.getEpochLength()} seconds`);
}

const serverPromise = tradeManager
  .init()
  .then(async () => {
    await walletManager.init();
    await usersWallet.init();
    walletManager.addWallet('users', usersWallet);
  })
  .then(() => {
    printConfig();
    return app.listen(PORT, () => logger.info('Listening on port ' + PORT));
  });

module.exports = {
  app,
  serverPromise,
  tradeManager,
};
