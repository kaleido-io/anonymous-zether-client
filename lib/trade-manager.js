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

const fs = require('fs-extra');
const AbiEncoder = require('web3-eth-abi');
const Web3 = require('web3');
const NodeCache = require('node-cache');
const timers = {
  sleep: require('util').promisify(require('timers').setTimeout),
};

const { getLogger, getEVMRevertMessage, getEpoch, HttpError } = require('./utils');
const Config = require('./config');
const bn128 = require('@anonymous-zether/anonymous.js/src/utils/bn128');
const bn128Utils = require('@anonymous-zether/anonymous.js/src/utils/utils');
const { OneTimeSignersWallet } = require('./keystore/hdwallet');
const Admin = require('./keystore/admin');
const RecoverBalanceCache = require('./recover-balance-cache');
const WalletManager = require('./wallet-manager');
const ShieldedWallet = require('./keystore/shielded');
const utils = require('./utils');
const { ZKP_PROOF_TYPE, TTL, RECOVER_BALANCE_CACHE_FILE, CACHE_LIMIT } = require('./constants');
const logger = getLogger();

const erc20ABI = require('./abi/erc20.json');
const zscABI = require('./abi/zsc.json');
const ONETIME_KEYS = 'onetime-keys';

// Manage ZSC related actions
//
// * register account
// * fund shielded account
// * withdraw (burn) from shielded account
// * transfer from one shielded account to another
//
class TradeManager {
  constructor() {
    this.dataDir = Config.getDataDir();
    const ethUrl = Config.getEthUrl();
    if (!ethUrl) {
      throw new Error('Must provide the URL for the Ethereum JSON RPC endpoint');
    }
    this.erc20 = Config.getERC20Address();
    if (!this.erc20) {
      throw new Error('Must provide the address of the ERC20 contract');
    }
    this.zsc = Config.getZSCAddress();
    if (!this.zsc) {
      throw new Error('Must provide the address of the ZSC contract');
    }
    this.hdwallet = new OneTimeSignersWallet();
    this.walletManager = new WalletManager();
    this.walletManager.addWallet(ONETIME_KEYS, this.hdwallet);
    this.defaultGas = 6721975;
    this.shieldedWallet = new ShieldedWallet();
    this.web3 = new Web3(ethUrl);
  }

  async init() {
    // setup hdwallet - used to generate throwaway accounts for signing
    await this.hdwallet.init();
    await this.walletManager.init();
    logger.info('Initialized HD Wallet for submitting transactions');
  }

  async initBalanceCache() {
    this.balanceCache = new RecoverBalanceCache(CACHE_LIMIT);
    const nodeCache = new NodeCache({ stdTTL: TTL, checkperiod: TTL * 0.2, useClones: false, deleteOnExpire: false });
    this.balanceCache.init(nodeCache);
    this.balanceCache.populateBalanceRange(0, 5000);
    try {
      logger.info('Populating the balance cache from file...');
      await this.balanceCache.populateCacheFromFile(RECOVER_BALANCE_CACHE_FILE);
    } catch (err) {
      logger.error(err);
    }
  }

  addSigningWallet(name, wallet) {
    this.walletManager.addWallet(name, wallet);
  }

  async registerAccount(ethAddress) {
    const shieldedAccount = await this.shieldedWallet.findShieldedAccount(ethAddress);
    if (shieldedAccount) {
      const { account } = await this.shieldedWallet.loadAccountByPublicKey(shieldedAccount);
      const [c, s] = bn128Utils.sign(this.zsc, { x: account._x, y: account.address });
      logger.info(`Registering shielded account ${shieldedAccount} with the ZSC contract`);
      const func = _locateFunctionOrEvent(zscABI, 'register');
      const args = [bn128.serialize(account.address), c, s];
      try {
        const receipt = await this.sendTransaction(this.zsc, ethAddress, func, args);
        logger.info(`Successfully registered shielded account ${shieldedAccount} with ZSC contract. (transactionHash: ${receipt.transactionHash})`);
      } catch (err) {
        await this._handleTxError(func, args, ethAddress, err);
        throw new HttpError(`Failed to register ${shieldedAccount}`, 500);
      }
    }
  }

  async mint(receiver, amount) {
    logger.info('Minting ERC20 tokens ...');
    const func = _locateFunctionOrEvent(erc20ABI, 'mint');
    const args = [receiver, amount];
    let admin;
    try {
      admin = Admin.getAccount(this.web3);
      const receipt = await this.sendTransaction(this.erc20, admin.address, func, args, { isAdminSigner: true });
      logger.info(`Successfully minted ${amount} tokens to ${receiver} in token ${this.erc20} (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this._handleTxError(func, args, admin.address, err);
      throw new HttpError('Failed to mint', 500);
    }
  }

  async getERC20Balance(ethAddress) {
    const func = _locateFunctionOrEvent(erc20ABI, 'balanceOf');
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

  async approveZSC(ethAddress, amount) {
    logger.info('Approving the ZSC contract as spender');
    const func = _locateFunctionOrEvent(erc20ABI, 'approve');
    const args = [this.zsc, amount];
    try {
      const receipt = await this.sendTransaction(this.erc20, ethAddress, func, args);
      logger.info(`Successfully approved the ZSC contract as custodian of ${amount} tokens for owner ${ethAddress} in token ${this.erc20} (transactionHash: ${receipt.transactionHash})`);
    } catch (err) {
      await this._handleTxError(func, args, ethAddress, err);
      throw new HttpError(`Failed to approve the ZSC contract as spender for the account ${ethAddress}`, 400);
    }
  }

  // funding involves the following steps
  //
  // * Locate the ERC20 for the zsc and the shielded account for the ethAccount
  // * Authorize the ERC20 to withdraw funds from the ERC20 contract
  // * Fund the shielded account from the balance in ERC20
  //
  async fundAccount(ethAddress, amount) {
    const shieldedAccount = await this.shieldedWallet.findShieldedAccount(ethAddress);
    if (!shieldedAccount) {
      logger.error(`ethAccount ${ethAddress} does not have a corresponding shielded account`);
      throw new HttpError(`ethAccount ${ethAddress} does not have a shielded account`, 400);
    }

    await this.approveZSC(ethAddress, amount);
    // now that we got here, initiate a fund transfer
    logger.info(`Funding shielded account for ${amount}`);
    const func = _locateFunctionOrEvent(zscABI, 'fund');
    const args = [shieldedAccount, amount];
    try {
      const receipt = await this.sendTransaction(this.zsc, ethAddress, func, args);
      logger.info(`Successfully funded shielded account ${shieldedAccount} for amount ${amount}: (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this._handleTxError(func, args, ethAddress, err);
      throw new HttpError(`Failed to fund shielded account ${shieldedAccount} for amount ${amount}`, 409);
    }
  }

  async getBalance(shieldedAddress) {
    const shieldedAccount = await this.shieldedWallet.loadAccountByPublicKey(shieldedAddress);
    if (!shieldedAccount) throw new HttpError(`Shielded account ${shieldedAddress} does not exist in this service locally, can not be used to decrypt balances`, 400);

    const epoch = getEpoch();
    const pubKey = bn128.serialize(shieldedAccount.account.address);
    const result = await this._simulateAccounts([pubKey], epoch);
    return await this._decryptEncryptedBalance(result[0], shieldedAccount.account);
  }

  // withdraw funds from a shielded account
  async withdraw(ethAddress, amount) {
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
    const wait = utils.timeBeforeNextEpoch() * 1000;
    const timeToBurn = utils.estimatedTimeForTxCompletion(2);
    logger.info(`wait till next epoch: ${wait}, estimated time to generate proof and burn: ${timeToBurn}`);
    /* istanbul ignore else */
    if (timeToBurn > wait) {
      logger.info(`Waiting for ${wait} ms till start of next epoch to withdraw`);
      await timers.sleep(wait);
    }

    let balance, shieldedAccountStates, epoch;
    try {
      const result = await this._checkBalance([shieldedAddress], 0, shieldedAccount, amount);
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
    logger.info('Generating proof, this might take some time}');
    let result;
    try {
      result = await shieldedAccount.generateProof(payload);
    } catch (err) {
      logger.error(`Proof generation failed with: ${err}`);
      throw new HttpError('Proof generation failed.');
    }

    logger.info('Withdrawal of shielded tokens in progress');
    const func = _locateFunctionOrEvent(zscABI, 'burn');
    const args = [shieldedAddress, amount, result.u, result.proof];
    try {
      // sending tx from ethAddress which is mapped to shieldedAddress
      // This ethAdress is the same as was used inside the proof. This is used to bypass the register requirement to avoid front-running.
      const receipt = await this.sendTransaction(this.zsc, ethAddress, func, args);
      logger.info(`withdrawal of shielded tokens was successful: (transactionHash: ${receipt.transactionHash})`);
      return receipt.transactionHash;
    } catch (err) {
      await this._handleTxError(func, args, ethAddress, err);
      throw new HttpError('Failed to complete withdrawal of shielded tokens', 409);
    }
  }

  // transfer does anonymous shielded transfer
  async transfer(senderAddress, receiverAddress, transferValue, decoys) {
    decoys = decoys || [];

    // use the Point objects for the shielded accounts for shuffling
    const senderPubicKey = bn128.deserialize(senderAddress);
    const receiverPublicKey = bn128.deserialize(receiverAddress);
    let publicKeys = decoys.map(bn128.deserialize);
    publicKeys = publicKeys.concat([senderPubicKey, receiverPublicKey]);

    let shuffleResult;
    try {
      shuffleResult = utils.shuffleAccountsWParityCheck(publicKeys, senderPubicKey, receiverPublicKey);
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
    const wait = utils.timeBeforeNextEpoch() * 1000;
    const timeToTransfer = utils.estimatedTimeForTxCompletion(shuffledAccounts.length);
    logger.info(`wait till next epoch: ${wait}, estimated time to generate proof and transfer: ${timeToTransfer}`);
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
      const result = await this._checkBalance(shuffledAddresses, indices[0], senderAccount, transferValue);
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
    logger.info('Generating proof, this might take some time');
    let result;
    try {
      result = await senderAccount.generateProof(payload);
    } catch (err) {
      logger.error(`Proof generation failed with: ${err}`);
      throw new HttpError('Proof generation failed.');
    }

    logger.info('Shielded transfer in progress');
    const beneficiary = bn128.serialize(bn128.zero);
    const func = _locateFunctionOrEvent(zscABI, 'transfer');
    const args = [result.L, result.R, shuffledAccounts.map(bn128.serialize), result.u, result.proof, beneficiary];
    let oneTimeAccount;
    try {
      oneTimeAccount = await this.walletManager.newAccount(ONETIME_KEYS);
      const response = await this.sendTransaction(this.zsc, oneTimeAccount.address, func, args, { gas: 7721975 });
      logger.info(`Shielded transfer successful: (transactionHash: ${response.transactionHash})`);
      return response.transactionHash;
    } catch (err) {
      await this._handleTxError(func, args, oneTimeAccount, err);
      throw new HttpError('Failed to complete shielded transfer', 409);
    }
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

  async _checkBalance(shieldedAddresses, myAddressIndex, myShieldedAccount, amount) {
    const epoch = getEpoch();
    const shieldedAccountStates = await this._simulateAccounts(shieldedAddresses, epoch);
    // get total shielded balance available
    const balance = await this._decryptEncryptedBalance(shieldedAccountStates[myAddressIndex], myShieldedAccount);
    logger.info(`Decrypted balance for the account to withdraw from: ${balance}`);

    if (balance < amount) {
      logger.error(`Amount to withdraw must be less than equal to shielded funds held by ${shieldedAddresses[myAddressIndex]}`);
      throw new HttpError('Amount to withdraw must be less than or equal to shielded funds');
    }

    return { balance, shieldedAccountStates, epoch };
  }

  async _simulateAccounts(shieldedAddresses, epoch) {
    const func = _locateFunctionOrEvent(zscABI, 'simulateAccounts');
    const contract = new this.web3.eth.Contract([func], this.zsc);
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

  async _handleTxError(func, args, from, err) {
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

function _locateFunctionOrEvent(abi, functionName) {
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

TradeManager.fs = fs;
TradeManager.timers = timers;
module.exports = TradeManager;
