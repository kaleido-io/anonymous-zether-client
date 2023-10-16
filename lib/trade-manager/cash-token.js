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

const { BaseClient, locateFunctionOrEvent } = require('./base');
const Admin = require('../keystore/admin');
const Config = require('../config');
const { getLogger, HttpError } = require('../utils');
const logger = getLogger();

const erc20ABI = require('../abi/erc20.json');

class CashTokenClient extends BaseClient {
  constructor(walletManager) {
    super(walletManager);

    this.erc20 = Config.getERC20Address();
    if (!this.erc20) {
      throw new Error('Must provide the address of the ERC20 contract');
    }
    this.admin = Admin.getAccount(this.web3);
  }

  async approve(ethAddress, spender, amount) {
    logger.info('Approving the ZSC contract as spender');
    const func = locateFunctionOrEvent(erc20ABI, 'approve');
    const args = [spender, amount];
    try {
      const receipt = await this.sendTransaction(this.erc20, ethAddress, func, args);
      logger.info(`Successfully approved the ZSC contract as custodian of ${amount} tokens for owner ${ethAddress} in token ${this.erc20} (transactionHash: ${receipt.transactionHash})`);
    } catch (err) {
      await this.handleTxError(func, args, ethAddress, err);
      throw new HttpError(`Failed to approve the ZSC contract as spender for the account ${ethAddress}`, 500);
    }
  }

  async mint(receiver, amount) {
    logger.info('Minting ERC20 tokens ...');
    const func = locateFunctionOrEvent(erc20ABI, 'mint');
    const args = [receiver, amount];
    try {
      const receipt = await this.sendTransaction(this.erc20, this.admin.address, func, args, { isAdminSigner: true });
      logger.info(`Successfully minted ${amount} tokens to ${receiver} in token ${this.erc20} (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, this.admin.address, err);
      throw new HttpError('Failed to mint', 500);
    }
  }

  async getERC20Balance(ethAddress) {
    const func = locateFunctionOrEvent(erc20ABI, 'balanceOf');
    const contract = new this.web3.eth.Contract([func], this.erc20);
    logger.info(`Retrieving balance of ${ethAddress} in ERC20`);
    try {
      const balance = await contract.methods.balanceOf(ethAddress).call();
      const value = balance.toString(10);
      logger.info(`Call result from balanceOf(): ${value}`);
      return value;
    } catch (err) {
      logger.error(`Failed to call balanceOf(). ${err}`);
      throw new HttpError('Failed to call balanceOf()');
    }
  }
}

module.exports = CashTokenClient;
