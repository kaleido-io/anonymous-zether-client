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
const Authority = require('../keystore/authority');
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
    this.authority = Authority.getAccount(this.web3);
  }

  //
  // methods in contract RealDigital.sol
  //
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
      const receipt = await this.sendTransaction(this.erc20, this.authority.address, func, args, { isAdminSigner: true });
      logger.info(`Successfully minted ${amount} tokens to ${receiver} in token contract ${this.erc20} (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, this.authority.address, err);
      throw new HttpError('Failed to mint', 500);
    }
  }

  async burn(amount) {
    logger.info('Burning ERC20 tokens ...');
    const func = locateFunctionOrEvent(erc20ABI, 'burn');
    const args = [amount];
    try {
      const receipt = await this.sendTransaction(this.erc20, this.authority.address, func, args, { isAdminSigner: true });
      logger.info(`Successfully burned ${amount} tokens from ${this.authority.address} in token contract ${this.erc20} (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, this.authority.address, err);
      throw new HttpError('Failed to burn', 500);
    }
  }

  async burnFrom(account, amount) {
    logger.info('Burning ERC20 tokens ...');
    const func = locateFunctionOrEvent(erc20ABI, 'burnFrom');
    const args = [account, amount];
    try {
      const receipt = await this.sendTransaction(this.erc20, this.authority.address, func, args, { isAdminSigner: true });
      logger.info(`Successfully burned ${amount} tokens from ${account} in token contract ${this.erc20} (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, this.authority.address, err);
      throw new HttpError('Failed to burn', 500);
    }
  }

  async moveAndBurn(account, amount) {
    logger.info('Moving and burning ERC20 tokens ...');
    const func = locateFunctionOrEvent(erc20ABI, 'moveAndBurn');
    const args = [account, amount];
    try {
      const receipt = await this.sendTransaction(this.erc20, this.authority.address, func, args, { isAdminSigner: true });
      logger.info(`Successfully moved and burned ${amount} tokens from ${account} in token contract ${this.erc20} (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, this.authority.address, err);
      throw new HttpError('Failed to move and burn', 500);
    }
  }

  async getBalance(ethAddress) {
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

  // privileged call by the CBDC treasury to transfer on behalf of the sender
  async move(sender, receiver, amount) {
    logger.info('Moving ERC20 tokens ...');
    const func = locateFunctionOrEvent(erc20ABI, 'move');
    const args = [sender, receiver, amount];
    try {
      const receipt = await this.sendTransaction(this.erc20, this.authority.address, func, args, { isAdminSigner: true });
      logger.info(`Successfully moved ${amount} tokens from ${sender} to ${receiver} in contract ${this.erc20} (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, this.authority.address, err);
      throw new HttpError('Failed to move', 500);
    }
  }

  // privileged call by the CBDC treasury to transfer on behalf of the sender
  async increaseFrozenBalance(account, amount) {
    logger.info('Increasing frozen balance ...');
    const func = locateFunctionOrEvent(erc20ABI, 'increaseFrozenBalance');
    const args = [account, amount];
    try {
      const receipt = await this.sendTransaction(this.erc20, this.authority.address, func, args, { isAdminSigner: true });
      logger.info(`Successfully increased frozen balance of ${account} by ${amount} in contract ${this.erc20} (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, this.authority.address, err);
      throw new HttpError('Failed to increase frozen balance', 500);
    }
  }

  // privileged call by the CBDC treasury to transfer on behalf of the sender
  async decreaseFrozenBalance(account, amount) {
    logger.info('Decreasing frozen balance ...');
    const func = locateFunctionOrEvent(erc20ABI, 'decreaseFrozenBalance');
    const args = [account, amount];
    try {
      const receipt = await this.sendTransaction(this.erc20, this.authority.address, func, args, { isAdminSigner: true });
      logger.info(`Successfully decreased frozen balance of ${account} by ${amount} in contract ${this.erc20} (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, this.authority.address, err);
      throw new HttpError('Failed to decrease frozen balance', 500);
    }
  }

  //
  // methods in CBDCAccessControl.sol
  //
  async enableAccount(ethAddress) {
    logger.info(`Enabling account ${ethAddress}`);
    const func = locateFunctionOrEvent(erc20ABI, 'enableAccount');
    const args = [ethAddress];
    try {
      const receipt = await this.sendTransaction(this.erc20, this.authority.address, func, args, { isAdminSigner: true });
      logger.info(`Successfully enabled account ${ethAddress} (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, ethAddress, err);
      throw new HttpError(`Failed to enable account ${ethAddress}`, 500);
    }
  }

  async disableAccount(ethAddress) {
    logger.info(`Disabling account ${ethAddress}`);
    const func = locateFunctionOrEvent(erc20ABI, 'disableAccount');
    const args = [ethAddress];
    try {
      const receipt = await this.sendTransaction(this.erc20, this.authority.address, func, args, { isAdminSigner: true });
      logger.info(`Successfully disabled account ${ethAddress} (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, ethAddress, err);
      throw new HttpError(`Failed to disable account ${ethAddress}`, 500);
    }
  }

  async isAuthorized(ethAddress) {
    logger.info(`Verifying account ${ethAddress}`);
    const func = locateFunctionOrEvent(erc20ABI, 'verifyAccount');
    const contract = new this.web3.eth.Contract([func], this.erc20);
    try {
      const verified = await contract.methods.verifyAccount(ethAddress).call();
      logger.info(`Successfully verified account ${ethAddress}: ${verified}`);
      return verified;
    } catch (err) {
      logger.error(`Failed to call verifyAccount(). ${err}`);
      throw new HttpError(`Failed to verify account ${ethAddress}`, 500);
    }
  }
}

module.exports = CashTokenClient;
