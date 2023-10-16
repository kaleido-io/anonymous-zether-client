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

const AbiEncoder = require('web3-eth-abi');
const Web3Utils = require('web3-utils');
const Web3 = require('web3');

const Config = require('../config');
const { getLogger, HttpError } = require('../utils');
const logger = getLogger();

class BaseClient {
  constructor(walletManager) {
    const ethUrl = Config.getEthUrl();
    if (!ethUrl) {
      throw new Error('Must provide the URL for the Ethereum JSON RPC endpoint');
    }

    this.defaultGas = 6721975;
    this.web3 = new Web3(ethUrl);
    this.walletManager = walletManager;
  }

  async sendTransaction(contractAddress, signer, methodABI, args, options) {
    if (!options) {
      options = { isAdminSigner: false, gas: this.defaultGas };
    } else if (!options.gas) {
      options.gas = this.defaultGas;
    }
    const callData = AbiEncoder.encodeFunctionCall(methodABI, args);
    const params = {
      from: options.isAdminSigner ? undefined : signer, // admin signer address will be set by the wallet manager
      data: callData,
      to: contractAddress,
      gasPrice: 0,
      value: '0x0',
      gas: options.gas,
    };

    let callTx;
    /* istanbul ignore else */
    let nonce;
    try {
      nonce = await this.web3.eth.getTransactionCount(signer);
    } catch (err) {
      logger.error('Failed to get transaction count to prepare the nonce for the contract', err);
      throw err;
    }

    params.nonce = '0x' + nonce.toString(16);

    const signedTx = await this.walletManager.sign(this.web3, signer, params, options.isAdminSigner);
    callTx = this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    return callTx
      .then((response) => {
        return response.contractAddress || response;
      })
      .catch(async (e) => {
        logger.error('Error while sending transaction', e);
        throw e;
      });
  }

  async handleTxError(func, args, from, err) {
    if (!err.receipt) {
      // this is not a transaction error, rethrow
      logger.error(err);
      return;
    }

    // try to get detailed evm message for failure
    const callData = AbiEncoder.encodeFunctionCall(func, args);
    const params = {
      data: callData,
      from,
      to: this.zsc,
      gasPrice: 0,
      value: '0x0',
      gas: this.defaultGas,
    };
    try {
      logger.info('Looking for detailed message from evm failure...');
      await getEVMRevertMessage(params, this.web3, err.receipt.blockNumber);
    } catch (err) {
      logger.error(err);
    }
  }
}

function locateFunctionOrEvent(abi, functionName) {
  const func = abi.filter((e) => {
    return e.name && e.name === functionName;
  });
  /* istanbul ignore next */
  if (func.length !== 1) {
    logger.error(`Failed to find ABI for function ${functionName}() in the compiled contract`);
    throw new HttpError(`Failed to find ABI for function ${functionName}() in the compiled contract`);
  }
  return func[0];
}

// attempt to get the reason for the transaction failure
// using eth_call and pass in the exact same input to execute the call on the
// target node directly without making it a transaction. Returned value is processed
// according to the control structure described at:
// https://solidity.readthedocs.io/en/v0.4.24/control-structures.html#error-handling-assert-require-revert-and-exceptions
async function getEVMRevertMessage(originalTxParam, web3, blockNumber) {
  const logger = getLogger();
  logger.info('Calling eth_call to find out details about evm revert failures');
  let execResult;
  try {
    execResult = await web3.eth.call(originalTxParam, blockNumber);
    logger.info(`Result: ${execResult}`);
  } catch (err) {
    const ERROR_MARKER = '0x08c379a0'; // keccak256 hash of "Error(string)"
    const PREFIX_LENGTH = ERROR_MARKER.length + 128;
    /* istanbul ignore else */
    if (execResult && execResult.indexOf(ERROR_MARKER) === 0 && execResult.length > PREFIX_LENGTH) {
      let offset = execResult.slice(10, 74); // first 32 bytes after the error marker are the offset
      offset = Web3Utils.hexToNumber('0x' + offset);

      let errlen = execResult.slice(74, 138); // next 32 bytes are the length of error string
      errlen = Web3Utils.hexToNumber('0x' + errlen);

      let end = PREFIX_LENGTH + errlen * 2; // error string length is in bytes, for hex string need to multiply by 2
      if (end > execResult.length) end = execResult.length;

      let errorString = execResult.slice(PREFIX_LENGTH, end);
      errorString = Web3Utils.hexToString('0x' + errorString);

      throw new Error(`Contract returned error: ${errorString}. Offset: ${offset}`);
    }
  }
}

module.exports = {
  BaseClient,
  locateFunctionOrEvent,
};
