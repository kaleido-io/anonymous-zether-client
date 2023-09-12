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
const { HttpError, getLogger } = require('./lib/utils');
const Config = require('./lib/config');
const ethWallet = new HDWallet('users');
const shieldedWallet = new ShieldedWallet();
const tradeManager = new TradeManager();
const walletManager = new WalletManager();
const logger = getLogger();

const PORT = 3000;

function contentType(req, res, next) {
  if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') && !req.is('application/json') && !(req.headers && req.headers['kaleido-custom-content-type'] === 'true')) {
    res.status(400);
    res.send({ message: 'Invalid content type' });
    return;
  } else {
    next();
  }
}

function requestLogger(req, res, next) {
  // Intercept end to do logging
  let _end = res.end.bind(res);
  let requestId = newRequestId();
  let start = Date.now();
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

function errorHandler(err, req, res, next) {
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
  expressify(async (req) => {
    return await shieldedWallet.getAccounts();
  }, getHandler)
);

apiRouter.post(
  '/accounts',
  expressify(async (req) => {
    const ethAccount = await walletManager.newAccount('users');
    const shieldedAccount = await shieldedWallet.createAccount(ethAccount.address);
    await tradeManager.registerAccount(ethAccount.address);
    return { eth: ethAccount.address, shielded: shieldedAccount };
  }, postHandler)
);

apiRouter.post(
  '/mint',
  expressify(async (req) => {
    const { ethAddress, amount } = req.body;
    if (!ethAddress) {
      throw new HttpError('Must provide signing address to draw fund from');
    }
    if (!amount) {
      throw new HttpError('Must provide funding amount');
    }
    return await tradeManager.mint(ethAddress, amount);
  }, postHandler)
);

apiRouter.post(
  '/fund',
  expressify(async (req) => {
    const { ethAddress, amount } = req.body;
    if (!ethAddress) {
      throw new HttpError('Must provide signing address to draw fund from');
    }
    if (!amount) {
      throw new HttpError('Must provide funding amount');
    }
    return await tradeManager.fundAccount(ethAddress, amount);
  }, postHandler)
);

apiRouter.post(
  '/transfer',
  expressify(async (req) => {
    return await transfer(req.params.contract_id, req);
  }, postHandler)
);

apiRouter.post(
  '/withdraw',
  expressify(async (req) => {
    return await withdraw(req.params.contract_id, req);
  }, postHandler)
);

apiRouter.get(
  '/accounts/:address/balance',
  expressify(async (req) => {
    const address = req.params.address;
    let balance;
    if (address.match(/^0x[0-9a-fA-F]{40}$/)) {
      // query for the ERC20 balance
      balance = await tradeManager.getERC20Balance(address);
    } else if (address.match(/^0x[0-9a-f]{64},0x[0-9a-f]{64}$/)) {
      // query for the Zether balance
      const shieldedAddress = address.split(',');
      balance = await tradeManager.getBalance(shieldedAddress);
    } else {
      throw new HttpError('Unknown address format', 400);
    }
    return { balance: balance };
  }, getHandler)
);

apiRouter.use(errorHandler);

function postHandler(req, res, result) {
  // eslint-disable-line no-unused-vars
  res.status(201);
  res.header('Content-Type', 'application/json');
  res.send(JSON.stringify({ result }, null, 2));
}

function getHandler(req, res, result) {
  res.status(200);
  res.header('Content-Type', 'application/json');
  res.send(JSON.stringify(result, null, 2));
}

function printConfig() {
  logger.info(`Configurations:`);
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
    await ethWallet.init();
    walletManager.addWallet('users', ethWallet);
  })
  .then(() => {
    printConfig();
    return app.listen(PORT, () => logger.info('Listening on port ' + PORT));
  });

module.exports = {
  app,
  serverPromise,
};
