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
    format: winston.format.simple(),
    transports: [new winston.transports.Console()],
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

  let tx = Object.assign(
    {
      from: account.address,
      value: '0x0', // required eth transfer value, of course we don't deal with eth balances in private consortia
    },
    payload
  );

  let signedTx = web3.eth.accounts.signTransaction(payload, account.privateKey);

  return signedTx;
}

function numberToHex(payload, property, required) {
  if ((payload[property] || required) && typeof payload[property] === 'number') {
    try {
      payload[property] = Web3Utils.numberToHex(payload[property]);
    } catch (err) {
      getLogger().error(`Failed to convert payload.${property} ${payload[property]} to hex`, err);
      throw new HttpError(`Failed to convert payload properties to hex`, 400);
    }
  }
}

// match checks if two shielded addresses (elgamal public keys(128 bits)) are same
// public keys are hex string array of size 2.
function match(address1, address2) {
  return address1[0] === address2[0] && address1[1] === address2[1];
}

// shuffleAccountsWParityCheck, shuffles the public keys used in anonymity set of a transaction.
// returns shuffled array, and indices of sender and receiver in that array.
// protocol requires that indices of sender and receiver are of opposite parity in the shuffled array.
// so function shifts receiver keys to one position left ot right in the array if shuffle results in
// sender and receiver being at indices with same parity.
function shuffleAccountsWParityCheck(accounts, sender, receiver) {
  var senderIndex = 0;
  var receiverIndex = 1;
  var m = accounts.length;
  // account lenth must be a power of 2 for proofs to work
  if (m == 0 || (m & (m - 1)) != 0) {
    //m is power of 2 should be checked before calling this function, This should be unreachable.
    logger.error(`Number of accounts in shuffle should be a power of 2`);
    throw new Error(`Number of accounts in shuffle should be a power of 2`);
  }
  while (m != 0) {
    // https://bost.ocks.org/mike/shuffle/
    var i = Math.floor(Math.random() * m--);
    var temp = accounts[i];
    accounts[i] = accounts[m];
    accounts[m] = temp;
    if (match(temp, sender)) senderIndex = m;
    else if (match(temp, receiver)) receiverIndex = m;
  } // shuffle the accounts array

  if (!match(accounts[senderIndex], sender)) {
    getLogger().error(`Sender address is not in the accounts array`);
    throw new Error(`Sender address is not in the accounts array`);
  }

  if (!match(accounts[receiverIndex], receiver)) {
    getLogger().error(`Receiver address is not in the accounts array`);
    throw new Error(`Receiver address is not in the accounts array`);
  }

  if (senderIndex % 2 == receiverIndex % 2) {
    temp = accounts[receiverIndex];
    let offset = receiverIndex % 2 == 0 ? 1 : -1;
    accounts[receiverIndex] = accounts[receiverIndex + offset];
    accounts[receiverIndex + offset] = temp;
    receiverIndex = receiverIndex + offset;
  } // make sure sender and receiver have opposite parity
  return { y: accounts, index: [senderIndex, receiverIndex] };
}

function estimatedTimeForTxCompletion(anonSetSize) {
  return Math.ceil(((anonSetSize * Math.log(anonSetSize)) / Math.log(2)) * 20 + 5200) + 20;
}

function timeBeforeNextEpoch() {
  const current = new Date().getTime() / 1000;
  const epochLength = Config.getEpochLength();
  return Math.ceil(current / epochLength) * epochLength - current;
}
module.exports = {
  HttpError,
  getLogger,
  atomicRW,
  signTransaction,
  match,
  shuffleAccountsWParityCheck,
  estimatedTimeForTxCompletion,
  timeBeforeNextEpoch,
};
