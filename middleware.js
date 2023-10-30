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

const randomstring = require('randomstring');

const { HttpError, getLogger } = require('./lib/utils');
const logger = getLogger();

function expressify(promiseFunc, responderFunc) {
  return (req, res) => {
    promiseFunc(req, res)
      .then((responseBody) => {
        responderFunc(req, res, responseBody);
      })
      .catch((err) => {
        errorHandler(err, req, res);
      });
  };
}

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

module.exports = {
  expressify,
  contentType,
  requestLogger,
  newRequestId,
};
