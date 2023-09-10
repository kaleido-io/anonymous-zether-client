'use strict';

const express = require('express');
const jsonBodyParser = require('body-parser').json();
const cors = require('cors');
const app = express();
const apiRouter = new express.Router();
const randomstring = require('randomstring');

const constants = require('./lib/constants.js');
const TradeManager = require('./lib/trade-manager.js');
const tradeManager = new TradeManager();

const { getAccounts, createAccount, getContracts, postContract, fundAccount, transfer } = require('./lib/services.js');

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
  errHandlerLogger.err(`${req.method} ${req.url} - request failed`, err);

  if (err instanceof PhoticError) {
    err.send(res, req.headers['x-photic-request-id']);
  } else if (err instanceof SyntaxError) {
    res.status(400).send({
      requestId: req.headers['x-photic-request-id'],
      errorMessage: 'Unexpected token in JSON',
    });
  } else {
    res.status(500);
    res.send({
      requestId: req.headers['x-photic-request-id'],
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
    return await getAccounts(req);
  }, getHandler)
);

apiRouter.post(
  '/accounts',
  expressify(async (req) => {
    return await createAccount(req);
  }, postHandler)
);

apiRouter.post(
  '/contracts',
  expressify(async (req) => {
    return await postContract(req);
  }, postHandler)
);

apiRouter.post(
  '/contracts/:contract_id/fund',
  expressify(async (req) => {
    return await fundAccount(req.params.contract_id, req);
  }, postHandler)
);

apiRouter.post(
  '/contracts/:contract_id/transfer',
  expressify(async (req) => {
    return await transfer(req.params.contract_id, req);
  }, postHandler)
);

apiRouter.post(
  '/contracts/:contract_id/withdraw',
  expressify(async (req) => {
    return await withdraw(req.params.contract_id, req);
  }, postHandler)
);

apiRouter.get(
  '/contracts',
  expressify(async (req) => {
    return await getContracts(req);
  }, getHandler)
);

apiRouter.get(
  '/contracts/:contract_id/balanceOf/:accountIndex',
  expressify(async (req) => {
    return await getBalance(req.params.contract_id, req.params.accountIndex);
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

const serverPromise = tradeManager.init().then(() => {
  return app.listen(PORT, () => logger.info('Listening on port ' + PORT));
});

module.exports = {
  app,
  serverPromise,
  serviceutil,
};
