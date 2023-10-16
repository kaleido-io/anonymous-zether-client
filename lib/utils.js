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

const winston = require('winston');
const Web3Utils = require('web3-utils');
const Config = require('./config');

class HttpError extends Error {
  /**
   * Constructor
   * @param {*} message The error message
   * @param {*} statusCode The status code
   */
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode || 500;
  }

  /**
   * Sends a response with this message
   * Sets custom header with error message for bff
   * @param {*} res The Express response object
   * @param {*} requestId Custom request ID
   * @returns {*} nothing
   */
  send(res, requestId) {
    res.status(this.statusCode);
    res.send({
      requestId,
      errorMessage: this.message,
    });
  }
}

let globalMUX; // One for any operation anywhere that is doing writes
async function atomicRW(fcn) {
  // reading and updating the config must be done atomically across concurrent REST requests
  // set up a module-scoped control gate
  while (globalMUX) {
    await globalMUX;
  }
  // tie the control gate to the method-scoped promise
  let updatesComplete;
  globalMUX = new Promise((resolve) => {
    updatesComplete = resolve;
  });

  try {
    return await fcn();
  } finally {
    globalMUX = undefined;
    updatesComplete();
  }
}

function getLogger() {
  const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
    format: winston.format.combine(
      winston.format.timestamp({
        format: () => {
          return new Date().toISOString();
        },
      }),
      winston.format.printf((info) => `${[info.timestamp]} [${info.level.toUpperCase()}] ${info.message}`)
    ),
  });
  return logger;
}

function signTransaction(web3, payload, account) {
  if (typeof web3 === 'undefined') {
    throw new HttpError('Missing required parameter "web3"', 400);
  }

  if (typeof payload === 'undefined') {
    throw new HttpError('Missing required parameter "payload"', 400);
  }

  if (typeof payload !== 'object') {
    throw new HttpError('Parameter "payload" must be an object', 400);
  }

  if (typeof payload.nonce === 'string' && payload.nonce.match(/0x[0-9A-Fa-f]+/) === null) {
    throw new HttpError('Parameter "payload.nonce" is detected as a string but not a valid "0x" prefixed hexidecimal number', 400);
  }

  numberToHex(payload, 'nonce', true);
  numberToHex(payload, 'gasPrice');
  numberToHex(payload, 'gasLimit');

  const tx = Object.assign(
    {
      from: account.address,
      value: '0x0', // required eth transfer value, of course we don't deal with eth balances in private consortia
    },
    payload
  );

  const signedTx = web3.eth.accounts.signTransaction(tx, account.privateKey);

  return signedTx;
}

function numberToHex(payload, property, required) {
  if ((payload[property] || required) && typeof payload[property] === 'number') {
    try {
      payload[property] = Web3Utils.numberToHex(payload[property]);
    } catch (err) {
      getLogger().error(`Failed to convert payload.${property} ${payload[property]} to hex`, err);
      throw new HttpError('Failed to convert payload properties to hex', 400);
    }
  }
}

function timeBeforeNextEpoch() {
  const current = new Date().getTime() / 1000;
  const epochLength = Config.getEpochLength();
  return Math.ceil(current / epochLength) * epochLength - current;
}

function isEthereumAddress(address) {
  return address.match(/^0x[0-9a-fA-F]{40}$/);
}

function isShieldedAddress(address) {
  return address.match(/^0x[0-9a-f]{64},0x[0-9a-f]{64}$/);
}

module.exports = {
  HttpError,
  getLogger,
  atomicRW,
  signTransaction,
  timeBeforeNextEpoch,
  isEthereumAddress,
  isShieldedAddress,
};
