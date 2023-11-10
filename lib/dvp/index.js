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

const Web3Utils = require('web3-utils');
const bn128 = require('@anonymous-zether/anonymous.js/src/utils/bn128');
const dvpABI = require('../abi/dvp.json');
const { locateFunctionOrEvent, BaseClient } = require('../base');
const { ONETIME_KEYS } = require('../constants');
const Config = require('../config');
const { getLogger, HttpError } = require('../utils');
const logger = getLogger();

class DvPClient extends BaseClient {
  constructor(tradeManager) {
    super(tradeManager.walletManager);

    this.tradeManager = tradeManager;
    this.walletManager = this.tradeManager.walletManager;
    this.shieldedWallet = this.tradeManager.zetherTokenClient.shieldedWallet;
    this.zsc = this.tradeManager.zetherTokenClient.zsc;
    this.dvp = Config.getDvPAddress();

    const eventDef = locateFunctionOrEvent(dvpABI, 'DvPStarted');
    const eventSignature = this.web3.eth.abi.encodeEventSignature(eventDef);
    const self = this;
    this.web3.eth
      .subscribe('logs', { topics: [eventSignature] }, function (error, result) {
        if (!error) self.decodeDvPStartedEvent(result.data, eventDef);
        else logger.error(`Error received from subscription: ${error}`);
      })
      .on('connected', function (subscriptionId) {
        logger.info(`Subscribed to events (subscription ID: ${subscriptionId})`);
      });
  }

  async startDvP(senderAddress, receiverAddress, transferValue, senderEthAddress, zsc) {
    const { result, shuffledAccounts } = await this.tradeManager.zetherTokenClient.prepareTransfer(senderAddress, receiverAddress, transferValue, zsc);

    const proofHash = Web3Utils.soliditySha3({ type: 'bytes', value: result.proof });
    const C = result.L;
    const D = result.R;
    const y = shuffledAccounts.map(bn128.serialize);
    const u = result.u;

    const func = locateFunctionOrEvent(dvpABI, 'startDvp');
    const args = [C, D, y, u, proofHash, zsc];
    let signer = senderEthAddress;
    try {
      if (!signer) {
        signer = await this.walletManager.newAccount(ONETIME_KEYS);
        signer = signer.address;
      }
      const response = await this.sendTransaction(this.dvp, signer, func, args);
      logger.info(`startDvp successful: (transactionHash: ${response.transactionHash})`);
      return { txHash: response.transactionHash, txSubmitter: signer, proof: result.proof };
    } catch (err) {
      await this.handleTxError(func, args, signer, err);
      throw new HttpError('Failed to complete startDvp', 409);
    }
  }

  async executeDvP(senderEthAddress, counterpartyEthAddress, proof) {
    const func = locateFunctionOrEvent(dvpABI, 'confirmDvp');
    const args = [proof, counterpartyEthAddress];
    try {
      const response = await this.sendTransaction(this.dvp, senderEthAddress, func, args, { gas: 8721975 });
      logger.info(`confirmDvp successful: (transactionHash: ${response.transactionHash})`);
      return response.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, senderEthAddress, err);
      throw new HttpError('Failed to complete executeDvp', 409);
    }
  }

  async decodeDvPStartedEvent(data, eventDef) {
    const decodedEvent = this.web3.eth.abi.decodeLog(eventDef.inputs, data, []);
    const { address, index } = await this.includesMyAccount(decodedEvent.parties);
    if (address) {
      const myAccount = await this.shieldedWallet.loadAccountByPublicKey(address);
      const encryptedAmount = decodedEvent.encryptedAmounts[index];
      logger.info('======================================================================');
      logger.info(`Decoded "DvpStarted" event parties has my shielded account, attempting to decrypt the amount ${encryptedAmount} (randomness: ${decodedEvent.randomness})`);
      const transferValue = await this.tradeManager.zetherTokenClient._decryptEncryptedBalance([encryptedAmount, decodedEvent.randomness], myAccount.account);
      logger.info(`Decrypted transfer value in the proposed DvP swap: ${transferValue}`);
      logger.info('======================================================================');
    }
  }

  async getShieldedAccounts() {
    const mappings = await this.shieldedWallet.getAccounts();
    return Object.values(mappings);
  }

  async includesMyAccount(parties) {
    const myShieldedAccounts = await this.getShieldedAccounts();
    for (let index in parties) {
      const party = parties[index];
      for (let account of myShieldedAccounts) {
        if (account[0] == party[0] && account[1] == party[1]) {
          return { address: account, index };
        }
      }
    }
    return { address: null };
  }
}

module.exports = DvPClient;
