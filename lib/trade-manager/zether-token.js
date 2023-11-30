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

const NodeCache = require('node-cache');
const crypto = require('crypto');
const timers = {
  sleep: require('util').promisify(require('timers').setTimeout),
};

const Web3Utils = require('web3-utils');
const bn128 = require('@anonymous-zether/anonymous.js/src/utils/bn128');
const bn128Utils = require('@anonymous-zether/anonymous.js/src/utils/utils');

const Authority = require('../keystore/authority');
const { BaseClient, locateFunctionOrEvent } = require('../base');
const { OneTimeSignersWallet } = require('../keystore/hdwallet');
const Config = require('../config');
const EncryptedBalanceCache = require('./balance-cache');
const { ZKP_PROOF_TYPE, TTL, RECOVER_BALANCE_CACHE_FILE, CACHE_LIMIT, ONETIME_KEYS } = require('../constants');
const { getLogger, timeBeforeNextEpoch, HttpError } = require('../utils');
const logger = getLogger();

const zscABI = require('../abi/zsc.json');

class ZetherTokenClient extends BaseClient {
  constructor(ethWalletManager, shieldedWallet, cashTokenClient) {
    super(ethWalletManager);

    this.hdwallet = new OneTimeSignersWallet();
    this.walletManager.addWallet(ONETIME_KEYS, this.hdwallet);
    this.shieldedWallet = shieldedWallet;
    this.cashTokenClient = cashTokenClient;
    this.authority = Authority.getAccount(this.web3);
  }

  async init() {
    // setup hdwallet - used to generate throwaway accounts for signing
    await this.hdwallet.init();
    await this.initBalanceCache();
    logger.info('Initialized HD Wallet for submitting transactions');
  }

  async initBalanceCache() {
    this.balanceCache = new EncryptedBalanceCache(CACHE_LIMIT);
    const nodeCache = new NodeCache({ stdTTL: TTL, checkperiod: TTL * 0.2, useClones: false, deleteOnExpire: false });
    this.balanceCache.init(nodeCache);
    try {
      logger.info('Populating the balance cache from file...');
      await this.balanceCache.populateCacheFromFile(RECOVER_BALANCE_CACHE_FILE);
    } catch (err) {
      logger.error(err);
    }
  }

  async registerAccount(ethAddress, name, zsc) {
    const shieldedAccount = await this.shieldedWallet.findShieldedAccount(ethAddress);
    if (shieldedAccount) {
      await this.registerShieldedAccount(shieldedAccount, name, zsc);
    }
  }

  async registerShieldedAccount(shieldedAccount, name, zsc) {
    const { account } = await this.shieldedWallet.loadAccountByPublicKey(shieldedAccount);
    const [c, s] = bn128Utils.sign(zsc, { x: account._x, y: account.address });
    logger.info(`Registering shielded account ${shieldedAccount} with the ZSC contract`);
    const func = locateFunctionOrEvent(zscABI, 'register');
    const args = [bn128.serialize(account.address), c, s, Web3Utils.fromAscii(name)];
    try {
      const receipt = await this.sendTransaction(zsc, this.authority.address, func, args, { isAdminSigner: true });
      logger.info(`Successfully registered shielded account ${shieldedAccount} with ZSC contract. (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, this.authority.address, err);
      throw new HttpError(`Failed to register ${shieldedAccount}`, 500);
    }
  }

  async getRegisteredAccounts(zsc) {
    const func = locateFunctionOrEvent(zscABI, 'getRegsiteredAccounts');
    const contract = new this.web3.eth.Contract([func], zsc);
    logger.info('Retrieving the list of registered shielded account with ZSC');
    let registeredAccounts;
    try {
      registeredAccounts = await contract.methods.getRegsiteredAccounts().call();
    } catch (err) {
      logger.error(`Failed to call getRegsiteredAccounts(). ${err}`);
      throw new HttpError('Failed to call getRegsiteredAccounts()');
    }
    const accounts = [];
    for (let entry of registeredAccounts) {
      let name;
      try {
        name = Web3Utils.toUtf8(entry.name);
      } catch (_error) {
        name = Web3Utils.toAscii(entry.name);
      }
      accounts.push({ name, address: entry.shieldedAddress });
    }
    return accounts;
  }

  // funding involves the following steps
  //
  // * Authorize the ERC20 to withdraw funds from the ERC20 contract
  // * Fund the shielded account from the balance in ERC20
  //
  async fundAccount(ethAddress, amount, zsc) {
    const shieldedAccount = await this.shieldedWallet.findShieldedAccount(ethAddress);
    if (!shieldedAccount) {
      logger.error(`ethAccount ${ethAddress} does not have a corresponding shielded account`);
      throw new HttpError(`ethAccount ${ethAddress} does not have a shielded account`, 400);
    }

    await this.cashTokenClient.approve(ethAddress, zsc, amount);

    logger.info(`Funding shielded account for ${amount}`);
    const func = locateFunctionOrEvent(zscABI, 'fund');
    const args = [shieldedAccount, amount];
    try {
      const receipt = await this.sendTransaction(zsc, ethAddress, func, args);
      logger.info(`Successfully funded shielded account ${shieldedAccount} for amount ${amount}: (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, ethAddress, err);
      throw new HttpError(`Failed to fund shielded account ${shieldedAccount} for amount ${amount}`, 409);
    }
  }

  async getBalance(shieldedAddress, zsc) {
    const shieldedAccount = await this.shieldedWallet.loadAccountByPublicKey(shieldedAddress);
    if (!shieldedAccount) throw new HttpError(`Shielded account ${shieldedAddress} does not exist in this service locally, can not be used to decrypt balances`, 400);

    const epoch = getEpoch();
    const pubKey = bn128.serialize(shieldedAccount.account.address);
    const result = await this._simulateAccounts([pubKey], epoch, zsc);
    return await this._decryptEncryptedBalance(result[0], shieldedAccount.account);
  }

  // transfer does anonymous shielded transfer
  async transfer(senderAddress, receiverAddress, transferValue, zsc, decoys) {
    const { result, shuffledAccounts } = await this.prepareTransfer(senderAddress, receiverAddress, transferValue, zsc, decoys);

    logger.info('Shielded transfer in progress');
    const beneficiary = bn128.serialize(bn128.zero);
    const func = locateFunctionOrEvent(zscABI, 'transfer');
    const args = [
      {
        C: result.L,
        D: result.R,
        y: shuffledAccounts.map(bn128.serialize),
        u: result.u,
        proof: result.proof,
        beneficiary,
      },
    ];
    let oneTimeAccount;
    try {
      oneTimeAccount = await this.walletManager.newAccount(ONETIME_KEYS);
      const response = await this.sendTransaction(zsc, oneTimeAccount.address, func, args, { gas: 7721975 });
      logger.info(`Shielded transfer successful: (transactionHash: ${response.transactionHash})`);
      return response.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, oneTimeAccount.address, err);
      throw new HttpError('Failed to complete shielded transfer', 409);
    }
  }

  // withdraw funds from a shielded account
  async withdraw(ethAddress, amount, zsc) {
    // get shielded account to be able to generate burn proof
    const shieldedAddress = await this.shieldedWallet.findShieldedAccount(ethAddress);
    if (!shieldedAddress) {
      logger.error(`Shielded account not found for ethereun account ${ethAddress}`);
      throw new HttpError(`Shielded account not found for ethereum account ${ethAddress}`, 400);
    }
    let shieldedAccount = await this.shieldedWallet.loadAccountByPublicKey(shieldedAddress);
    if (!shieldedAccount) {
      throw new HttpError(`Shielded account ${shieldedAddress} does not exist in this service locally, can not be used to withdraw funds`, 400);
    } else {
      shieldedAccount = shieldedAccount.account;
    }

    // check if need to wait till next epoch
    const wait = timeBeforeNextEpoch() * 1000;
    const timeToBurn = estimatedTimeForTxCompletion(2);
    logger.info(`Time till next epoch: ${wait}, estimated time to generate proof and burn: ${timeToBurn}`);
    /* istanbul ignore else */
    if (timeToBurn > wait) {
      logger.info(`Waiting for ${wait} ms till start of next epoch to withdraw`);
      await timers.sleep(wait);
    }

    let balance, shieldedAccountStates, epoch;
    try {
      const result = await this._checkBalance([shieldedAddress], 0, shieldedAccount, amount, zsc);
      balance = result.balance;
      shieldedAccountStates = result.shieldedAccountStates;
      epoch = result.epoch;
    } catch (err) {
      logger.error(`Failed to check balance for shielded account ${shieldedAddress} with ZSC. ${err}`);
      throw new HttpError(`Failed to check balance for shielded account ${shieldedAddress} with ZSC. ${err}`);
    }

    // prepare payload for proof generator
    const payload = {};
    payload.type = ZKP_PROOF_TYPE.BURN_PROOF;
    const data = {};
    data.burnAccount = shieldedAccount.address; // use the Point type instead of the serialized type
    data.burnAccountState = shieldedAccountStates[0];
    data.value = amount;
    data.balanceAfterTransfer = balance - amount;
    data.epoch = epoch;
    data.sender = ethAddress;
    payload.args = data;

    // generate transfer proof using sender's account
    logger.info(`Generating proof, this might take some time (epoch=${epoch})`);
    let result;
    try {
      result = await shieldedAccount.generateProof(payload);
    } catch (err) {
      logger.error(`Proof generation failed with: ${err}`);
      throw new HttpError('Proof generation failed.');
    }

    logger.info('Withdrawal of shielded tokens in progress');
    const func = locateFunctionOrEvent(zscABI, 'burn');
    const args = [shieldedAddress, amount, result.u, result.proof];
    try {
      // sending tx from ethAddress which is mapped to shieldedAddress
      // This ethAdress is the same as was used inside the proof. This is used to bypass the register requirement to avoid front-running.
      const receipt = await this.sendTransaction(zsc, ethAddress, func, args);
      logger.info(`withdrawal of shielded tokens was successful: (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this.handleTxError(func, args, ethAddress, err);
      throw new HttpError('Failed to complete withdrawal of shielded tokens', 409);
    }
  }

  async _checkBalance(shieldedAddresses, myAddressIndex, myShieldedAccount, amount, zsc) {
    const epoch = getEpoch();
    const shieldedAccountStates = await this._simulateAccounts(shieldedAddresses, epoch, zsc);
    // get total shielded balance available
    const balance = await this._decryptEncryptedBalance(shieldedAccountStates[myAddressIndex], myShieldedAccount);
    logger.info(`Decrypted balance for the account to withdraw from: ${balance}`);

    if (balance < amount) {
      logger.error(`Amount to withdraw must be less than equal to shielded funds held by ${shieldedAddresses[myAddressIndex]}`);
      throw new HttpError('Amount to withdraw must be less than or equal to shielded funds');
    }

    return { balance, shieldedAccountStates, epoch };
  }

  async _simulateAccounts(shieldedAddresses, epoch, zsc) {
    const func = locateFunctionOrEvent(zscABI, 'simulateAccounts');
    const contract = new this.web3.eth.Contract([func], zsc);
    logger.info('Retrieving state of shielded account with ZSC');
    let shieldedAccountStates;
    try {
      shieldedAccountStates = await contract.methods.simulateAccounts(shieldedAddresses, epoch).call();
      logger.info(`Call result from simulateAccounts(): ${JSON.stringify(shieldedAccountStates)}`);
    } catch (err) {
      logger.error(`Failed to call simulateAccounts(). ${err}`);
      throw new HttpError('Failed to call simulateAccounts()');
    }
    return shieldedAccountStates;
  }

  async _decryptEncryptedBalance(encryptedBalance, shieldedAccount) {
    let gBalance;
    try {
      gBalance = shieldedAccount.decrypt({ c1: encryptedBalance[0], c2: encryptedBalance[1] });
    } catch (err) {
      logger.error('Failed to decrypt balance', err);
      throw new HttpError('Failed to decrypt balance');
    }
    let balance = await this._recoverBalance(gBalance);
    return balance;
  }

  async _recoverBalance(gBalance) {
    // initialize the cache if not done already
    try {
      if (!this.balanceCache) {
        this.initBalanceCache();
      }
      const startTime = new Date().getTime();
      const cachedBalance = await this.balanceCache.get(gBalance, invertGBalance);
      const endTime = new Date().getTime();
      logger.info(`time taken to recover in ms ${endTime - startTime}`);
      logger.info(`cached balance: ${cachedBalance}`);
      return cachedBalance;
    } catch (err) {
      logger.error(err);
      throw new HttpError('Failed to recover balance');
    }
  }

  async prepareTransfer(senderAddress, receiverAddress, transferValue, zsc, decoys) {
    decoys = decoys || [];

    // use the Point objects for the shielded accounts for shuffling
    const senderPubicKey = bn128.deserialize(senderAddress);
    const receiverPublicKey = bn128.deserialize(receiverAddress);
    let publicKeys = decoys.map(bn128.deserialize);
    publicKeys = publicKeys.concat([senderPubicKey, receiverPublicKey]);

    let shuffleResult;
    try {
      shuffleResult = shuffleAccountsWParityCheck(publicKeys, senderPubicKey, receiverPublicKey);
    } catch (err) {
      logger.error(`Error while shuffling accounts array. ${err}`);
      throw new HttpError('Error while shuffling accounts array');
    }
    const shuffledAccounts = shuffleResult.y;
    // Sender and receiver index in shuffled account array, passed as witness for the transfer proof
    // senderIndex = indices[0]
    // receiverIndex = indices[1]
    const indices = shuffleResult.index;

    // check if need to wait till next epoch
    const wait = timeBeforeNextEpoch() * 1000;
    const timeToTransfer = estimatedTimeForTxCompletion(shuffledAccounts.length);
    logger.info(`Time till next epoch: ${wait}, estimated time to generate proof and transfer: ${timeToTransfer}`);
    if (timeToTransfer > wait) {
      logger.info(`Waiting for ${wait} ms till start of next epoch to transfer`);
      await timers.sleep(wait);
    }

    // get sender account to be able to generate proof
    let senderAccount;
    try {
      senderAccount = await this.shieldedWallet.loadAccountByPublicKey(senderAddress);
      if (!senderAccount) {
        throw new Error('Faile to find account in local storage');
      } else {
        senderAccount = senderAccount.account;
      }
    } catch (err) {
      throw new HttpError(`Shielded account ${senderAddress} does not exist locally, can not be used to transfer funds`, 400);
    }

    const shuffledAddresses = shuffledAccounts.map(bn128.serialize);
    let balance, shieldedAccountStates, epoch;
    try {
      const result = await this._checkBalance(shuffledAddresses, indices[0], senderAccount, transferValue, zsc);
      balance = result.balance;
      shieldedAccountStates = result.shieldedAccountStates;
      epoch = result.epoch;
    } catch (err) {
      logger.error(`Failed to check balance for shielded account ${senderAddress} with ZSC. ${err}`);
      throw new HttpError(`Failed to check balance for shielded account ${senderAddress} with ZSC. ${err}`);
    }

    // prepare payload for proof generator
    const payload = {};
    payload.type = ZKP_PROOF_TYPE.TRANSFER_PROOF;
    const data = {};
    data.anonSet = shuffledAccounts;
    data.anonSetStates = shieldedAccountStates;
    data.randomness = bn128.randomScalar();
    data.value = transferValue;
    data.index = indices;
    data.balanceAfterTransfer = balance - transferValue;
    data.epoch = epoch;
    payload.args = data;

    // generate transfer proof using sender's account
    logger.info(`Generating proof, this may take some time (epoch=${epoch})`);
    let result;
    try {
      result = await senderAccount.generateProof(payload);
    } catch (err) {
      logger.error(`Proof generation failed with: ${err}`);
      throw new HttpError('Proof generation failed.');
    }

    return { result, shuffledAccounts };
  }
}

// calculates the Epoch according to the epoch length used by the Anonymous Zether contract
function getEpoch() {
  return Math.floor(new Date().getTime() / (Config.getEpochLength() * 1000));
}

function estimatedTimeForTxCompletion(anonSetSize) {
  return Math.ceil(((anonSetSize * Math.log(anonSetSize)) / Math.log(2)) * 20 + 5200) + 20;
}

function invertGBalance(gBalance) {
  let accumulator = bn128.zero;
  for (let i = 0; i < bn128.B_MAX; i++) {
    if (accumulator.eq(gBalance)) {
      return i;
    }
    accumulator = accumulator.add(bn128.curve.g);
  }
  throw new Error("Can't invert gBalance to Balance");
}

// shuffleAccountsWParityCheck, shuffles the public keys used in anonymity set of a transaction.
// returns shuffled array, and indices of sender and receiver in that array.
// protocol requires that indices of sender and receiver are of opposite parity in the shuffled array.
// so function shifts receiver keys to one position left to right in the array if shuffle results in
// sender and receiver being at indices with same parity.
function shuffleAccountsWParityCheck(y, sender, receiver) {
  const index = [];
  let m = y.length;
  // shuffle the array of y's
  while (m !== 0) {
    // https://bost.ocks.org/mike/shuffle/
    const i = crypto.randomBytes(1).readUInt8() % m--; // warning: N should be <= 256. also modulo bias.
    const temp = y[i];
    y[i] = y[m];
    y[m] = temp;
    if (sender.eq(temp)) index[0] = m;
    else if (receiver.eq(temp)) index[1] = m;
  }
  // make sure you and your friend have opposite parity (one at odd position, one at even position)
  if (index[0] % 2 === index[1] % 2) {
    const temp = y[index[1]];
    y[index[1]] = y[index[1] + (index[1] % 2 === 0 ? 1 : -1)];
    y[index[1] + (index[1] % 2 === 0 ? 1 : -1)] = temp;
    index[1] = index[1] + (index[1] % 2 === 0 ? 1 : -1);
  }

  return { y, index };
}

ZetherTokenClient.timers = timers;
module.exports = ZetherTokenClient;
