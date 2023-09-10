'use strict';

const fs = require('fs-extra');
const { join } = require('path');
const AbiEncoder = require('web3-eth-abi');
const { Web3 } = require('web3');
const NodeCache = require('node-cache');
const timers = {
  sleep: require('util').promisify(require('timers').setTimeout),
};

const { atomicRW, getLogger, HttpError } = require('./utils');
const Config = require('./config.js');
const bn128 = require('@anonymous-zether/anonymous.js/src/utils/bn128.js');
const { OneTimeSignersWallet } = require('./keystore/hdwallet/index.js');
const RecoverBalanceCache = require('./recover-balance-cache.js');
const WalletManager = require('./wallet-manager');
const { ETH_SHIELD_ACCOUNT_MAPPING, ZSC_EPOCH_LENGTH, ZKP_PROOF_TYPE, TTL, RECOVER_BALANCE_CACHE_FILE, CACHE_LIMIT } = require('./constants');
const logger = getLogger();

const approveABI = require('./abi/approve.json');
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
    this.web3 = new Web3(ethUrl);
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
    this.defaultGas = 1000000;
  }

  async init() {
    // setup hdwallet - used to generate throwaway accounts for signing
    await this.hdwallet.init();
    await this.walletManager.init();
    logger.info(`Initialized HD Wallet for submitting transactions`);
    // TODO: use db to track used signing account indices
    this.signingAccountIndex = 0;
  }

  async initBalanceCache() {
    this.balanceCache = new RecoverBalanceCache(CACHE_LIMIT);
    let nodeCache = new NodeCache({ stdTTL: TTL, checkperiod: TTL * 0.2, useClones: false, deleteOnExpire: false });
    this.balanceCache.init(nodeCache);
    //TODO: remove from here if cache file works e2e, populate it for current use.
    this.balanceCache.populateBalanceRange(0, 5000);
    //fire and forget, do in the background, populate
    try {
      await this.balanceCache.populateCacheFromFile(RECOVER_BALANCE_CACHE_FILE);
    } catch (err) {
      logger.error(err);
    }
  }

  addSigningWallet(name, wallet) {
    this.walletManager.addWallet(name, wallet);
  }

  async findShieldedAccount(address) {
    let accountMappings = [];
    await atomicRW(async () => {
      try {
        accountMappings = JSON.parse(await fs.readFile(join(this.dataDir, ETH_SHIELD_ACCOUNT_MAPPING)));
      } catch (err) {
        logger.warn(`Accounts mapping file ${join(this.dataDir, ETH_SHIELD_ACCOUNT_MAPPING)} not found`);
      }
    });

    let shieldedAccount;
    shieldedAccount = accountMappings.find((accountPair) => accountPair.ethAccount.address === address);
    return shieldedAccount;
  }

  async approveZSC(ethAddress, amount) {
    logger.info(`Now approving zsc as spender`);
    let func = _locateFunctionOrEvent(approveABI, 'approve');
    let args = [this.zsc, amount];
    try {
      let receipt = await this.sendTransaction(this.erc20, ethAddress, func, args);
      logger.info(`Successfully approved ${this.zsc} as custodian of ${amount} tokens for owner ${ethAddress} in token ${this.erc20} (transactionHash: ${receipt.transactionHash})`);
    } catch (e) {
      logger.error(`Error while calling approve() on token contract ${this.erc20}`, e);
      throw new HttpError(`Failed to approve ${this.zsc} as spender for the account ${ethAddress}`, 400);
    }
  }
  async _fundAccount(ethAddress, amount, shieldedAccount) {
    logger.info(`Funding shielded account for ${amount}`);
    let func = _locateFunctionOrEvent(zscABI, 'fund');
    let args = [shieldedAccount['shieldedAccount'], amount]; // the mapping is of type {ethAccount: x, shieldedAccount: [a, b]}
    try {
      let receipt = await this.sendTransaction(this.zsc, ethAddress, func, args);
      logger.info(`Successfully funded shielded account ${JSON.stringify(shieldedAccount)} for amount ${amount}: (transactionHash: ${receipt.transactionHash})`);
    } catch (e) {
      logger.error(`Error while calling fund() on zsc ${this.zsc}`, e);
      throw new HttpError(`Failed to fund shielded account ${JSON.stringify(shieldedAccount)} for amount ${amount}`, 409);
    }
  }

  // funding involves the following steps
  //
  // * Locate the ERC20 for the zsc and the shielded account for the ethAccount
  // * Authorize the ERC20 to withdraw funds from the ERC20 contract
  // * Fund the shielded account from the balance in ERC20
  //
  async fundAccount(ethAddress, amount) {
    let shieldedAccount = await this.findShieldedAccount(ethAddress);
    if (!shieldedAccount) {
      logger.error(`ethAccount ${ethAddress} does not have a corresponding shielded account`);
      throw new HttpError(`ethAccount ${ethAddress} does not have a shielded account`, 400);
    }

    await this.approveZSC(ethAddress, amount);
    // now that we got here, initiate a fund transfer
    await this._fundAccount(ethAddress, amount, shieldedAccount);
  }

  // withdraw funds from a shielded account
  async withdraw(zsc, ethAddress, shieldedAddress, amount) {
    zsc = zsc.toLowerCase();
    if (!shieldedAddress) {
      let localshieldedMapping = await this.findShieldedAccount(ethAddress);
      if (!localshieldedMapping) {
        logger.error(`ethAccount ${ethAddress} does not have a corresponding shielded account`);
        throw new HttpError(`ethAccount ${ethAddress} does not have a shielded account`, 400);
      }
      shieldedAddress = localshieldedMapping.shieldedAccount;
    }
    // get shielded account to be able to generate burn proof
    let shieldedAccounts = await this.walletManager.wallets[WALLET_TYPE.SHIELDED_LOCAL].getAccounts();
    let shieldedAccount = shieldedAccounts.find((sa) => sa.account.isSameAddress(shieldedAddress));
    if (!shieldedAccount) {
      throw new HttpError(`Shielded account ${shieldedAddress} does not exist in this service locally, can not be used to withdraw funds`, 400);
    } else {
      shieldedAccount = shieldedAccount.account;
    }

    // check if need to wait till next epoch
    var wait = utils.timeBeforeNextEpoch() * 1000;
    var timeToBurn = utils.estimatedTimeForTxCompletion(2);
    logger.info(`wait till next epoch: ${wait}, estimated time to generate proof and burn: ${timeToBurn}`);
    /* istanbul ignore else */
    if (timeToBurn > wait) {
      logger.info(`Waiting for ${wait} ms till start of next epoch to withdraw`);
      await timers.sleep(wait);
    }

    let func = _locateFunctionOrEvent(ZSC_ABI, 'simulateAccounts');
    let epoch = Math.floor(new Date().getTime() / 1000 / ZSC_EPOCH_LENGTH);
    let web3 = await this.serviceutil.getRPCConnection();
    let contract = new web3.eth.Contract([func], zsc);
    let shieldedAccountState;
    logger.info(`Retrieving state of shielded account with ZSC ${zsc}`);
    try {
      shieldedAccountState = await contract.methods.simulateAccounts([shieldedAddress], epoch).call();
      logger.info(`Call result from simulateAccounts()`, shieldedAccountState);
    } catch (err) {
      logger.error(`Failed to call simulateAccounts()`, err);
      throw new HttpError(`Failed to call simulateAccounts()`);
    }

    // get total shielded balance available
    let balance = await this._decryptEncryptedBalance(shieldedAccountState[0], shieldedAccount);

    if (balance < amount) {
      logger.error(`Amount to withdraw must be less than equal to shielded funds held by ${shieldedAddress}`);
      throw new HttpError(`Amount to withdraw must be less than or equal to shielded funds`);
    }

    // prepare payload for proof generator
    var payload = {};
    payload.type = ZKP_PROOF_TYPE.BURN_PROOF;
    var data = {};
    data.burnAccount = shieldedAddress;
    data.burnAccountState = shieldedAccountState[0];
    data.value = amount;
    data.balanceAfterTransfer = balance - amount;
    data.epoch = epoch;
    data.sender = ethAddress;
    payload.args = data;

    // generate transfer proof using sender's account
    logger.info(`Generating proof, this might take some time ${zsc}`);
    let result;
    try {
      result = await shieldedAccount.generateProof(payload);
    } catch (err) {
      logger.error(`Proof generation failed with: ${err}`);
      throw new HttpError(`Proof generation failed.`);
    }
    var withdrawArgs = {};
    withdrawArgs.proof = result.data.proof;
    withdrawArgs.u = result.data.u;
    withdrawArgs.y = shieldedAddress;
    withdrawArgs.value = amount;
    withdrawArgs.sender = ethAddress;
    await this._withdraw(zsc, withdrawArgs);
  }

  async _withdraw(zsc, withdrawArgs) {
    logger.info(`Withdrawal of shielded tokens in progress`);
    let func = _locateFunctionOrEvent(ZSC_ABI, 'burn');
    let args = [withdrawArgs.y, withdrawArgs.value, withdrawArgs.u, withdrawArgs.proof];
    try {
      // sending tx from ethAddress which is mapped to shieldedAddress
      // This ethAdress is the same as was used inside the proof. This is used to bypass the register requirement to avoid front-running.
      let receipt = await this.walletManager.sendTransaction(func, args, zsc, withdrawArgs.sender, await this.serviceutil.getRPCConnection());
      logger.info(`withdrawal of shielded tokens was successful: (transactionHash: ${receipt.transactionHash})`);
    } catch (e) {
      logger.error(`Error while calling burn() on zsc ${zsc}`, e);
      throw new HttpError(`Failed to complete withdrawal of shielded tokens`, 409);
    }
  }

  // transfer does anonymous shielded transfer
  async transfer(zsc, senderAddress, receiverAddress, transferValue, decoys) {
    decoys = decoys ? decoys.concat([senderAddress, receiverAddress]) : [];

    let shuffleResult;
    try {
      shuffleResult = utils.shuffleAccountsWParityCheck(decoys, senderAddress, receiverAddress);
    } catch (err) {
      logger.error(`Error while shuffling accounts array`);
      throw new HttpError(`Error while shuffling accounts array`);
    }
    let shuffledAccounts = shuffleResult.y;
    // Sender and receiver index in shuffled account array, passed as witness for the transfer proof
    // senderIndex = indices[0]
    // receiverIndex = indices[1]
    let indices = shuffleResult.index;

    // check if need to wait till next epoch
    var wait = utils.timeBeforeNextEpoch() * 1000;
    var timeToTransfer = utils.estimatedTimeForTxCompletion(shuffledAccounts.length);
    logger.info(`wait till next epoch: ${wait}, estimated time to generate proof and transfer: ${timeToTransfer}`);
    if (timeToTransfer > wait) {
      logger.info(`Waiting for ${wait} ms till start of next epoch to transfer`);
      await timers.sleep(wait);
    }

    zsc = zsc.toLowerCase();
    let func = _locateFunctionOrEvent(ZSC_ABI, 'simulateAccounts');
    let epoch = Math.floor(new Date().getTime() / 1000 / ZSC_EPOCH_LENGTH);
    let web3 = await this.serviceutil.getRPCConnection();
    let contract = new web3.eth.Contract([func], zsc);
    let accountStates;
    logger.info(`Retrieving state of all accounts part of shielded transfer with ZSC ${zsc}`);
    try {
      accountStates = await contract.methods.simulateAccounts(shuffledAccounts, epoch).call();
      logger.info(`Call result from simulateAccounts()`, accountStates);
    } catch (err) {
      logger.error(`Failed to call simulateAccounts()`, err);
      throw new HttpError(`Failed to call simulateAccounts()`);
    }
    // get sender account to be able to generate proof
    let shieldedAccounts = await this.walletManager.wallets[WALLET_TYPE.SHIELDED_LOCAL].getAccounts();
    let senderAccount = shieldedAccounts.find((sa) => sa.account.isSameAddress(senderAddress));
    if (!senderAccount) {
      throw new HttpError(`Shielded account ${senderAddress} does not exist in this service locally, can not be used to transfer funds`, 400);
    } else {
      senderAccount = senderAccount.account;
    }

    // get sender account balance
    let encryptedState = accountStates[indices[0]];
    let balance = await this._decryptEncryptedBalance(encryptedState, senderAccount);
    if (balance < transferValue) {
      logger.error(`Insufficient balance in sender's shielded account ${senderAddress}`);
      throw new HttpError(`Insufficient balance in sender's shielded account`);
    }

    // prepare payload for proof generator
    var payload = {};
    payload.type = ZKP_PROOF_TYPE.TRANSFER_PROOF;
    var data = {};
    data.anonSet = shuffledAccounts;
    data.anonSetStates = accountStates;
    data.randomness = bn128.randomScalar();
    data.value = transferValue;
    data.index = indices;
    data.balanceAfterTransfer = balance - transferValue;
    data.epoch = epoch;
    payload.args = data;

    // generate transfer proof using sender's account
    logger.info(`Generating proof, this might take some time ${zsc}`);
    let result;
    try {
      result = await senderAccount.generateProof(payload);
    } catch (err) {
      logger.error(`Proof generation failed with: ${err}`);
      throw new HttpError(`Proof generation failed.`);
    }

    var transferArgs = {};
    transferArgs.proof = result.data.proof;
    transferArgs.L = result.data.L;
    transferArgs.R = result.data.R;
    transferArgs.u = result.data.u;
    transferArgs.y = shuffledAccounts;
    logger.info(`Shuffled accounts`, transferArgs.y);
    logger.info(`Proof result, proof: ${transferArgs.proof}, L: ${transferArgs.L}, R: ${transferArgs.R}, u: ${transferArgs.u}, y: ${transferArgs.y}`);
    await this._transfer(zsc, transferArgs);
  }

  async signWithThrowAwayAccount(func, args, zsc) {
    // send using a throwaway account.
    let signingAccount = await this.generateThrowAwayAccount();
    logger.info(`One-time signing account address: ${signingAccount.address}`);
    return await this.sendTransaction(zsc, signingAccount, func, args);
  }

  async _transfer(zsc, transferArgs) {
    logger.info(`Shielded transfer in progress`);
    let func = _locateFunctionOrEvent(ZSC_ABI, 'transfer');
    let args = [transferArgs.L, transferArgs.R, transferArgs.y, transferArgs.u, transferArgs.proof];
    try {
      let response = await this.signWithThrowAwayAccount(func, args, zsc);
      logger.info(`Shielded transfer successful: (transactionHash: ${response.transactionHash})`);
    } catch (e) {
      // try to get detailed evm message for failure
      let callData = AbiEncoder.encodeFunctionCall(func, args);
      let params = {
        data: callData,
        to: zsc,
        gasPrice: 0,
        value: '0x0',
        gas: this.defaultGas,
      };
      try {
        logger.info(`Looking for detailed message from evm failure...`);
        await this.walletManager.getEVMRevertMessage(params, await this.serviceutil.getRPCConnection());
      } catch (err) {
        logger.error(err);
      }
      ////////////
      logger.error(`Error while calling transfer() on zsc ${zsc}`, e);
      throw new HttpError(`Failed to complete shielded transfer`, 409);
    }
  }

  async _getBalance(zsc, shieldedAccount, epoch) {
    let func = _locateFunctionOrEvent(ZSC_ABI, 'simulateAccounts');
    let web3 = await this.serviceutil.getRPCConnection();
    let contract = new web3.eth.Contract([func], zsc);
    logger.info(`Retrieving balance of shielded account with ZSC ${zsc}`, shieldedAccount.address);
    let result;
    try {
      result = await contract.methods.simulateAccounts([shieldedAccount.address], epoch).call();
      logger.info(`Call result from simulateAccounts()`, result);
    } catch (err) {
      logger.error('Failed to call simulateAccounts()', err);
      throw new HttpError(`Failed to call simulateAccounts()`);
    }
    return await this._decryptEncryptedBalance(result[0], shieldedAccount);
  }

  async _decryptEncryptedBalance(encryptedBalance, shieldedAccount) {
    let gBalance;
    try {
      gBalance = shieldedAccount.decrypt({ c1: encryptedBalance[0], c2: encryptedBalance[1] });
    } catch (err) {
      logger.error('Failed to decrypt balance', err);
      throw new HttpError('Failed to decrypt balance');
    }
    let balance = -1;
    try {
      balance = await this._recoverBalance(gBalance);
    } catch (e) /* istanbul ignore next */ {
      throw e;
    }
    return balance;
  }

  async _recoverBalance(gBalance) {
    // initialize the cache if not done already
    try {
      if (!this.balanceCache) {
        this.initBalanceCache();
      }
      let startTime = new Date().getTime();
      let cachedBalance = await this.balanceCache.get(gBalance, invertGBalance);
      let endTime = new Date().getTime();
      logger.info(`time taken to recover in ms ${endTime - startTime}`);
      logger.info(`cached balance: ${cachedBalance}`);
      return cachedBalance;
    } catch (err) {
      logger.error(err);
      throw new HttpError(`Failed to recover balance`);
    }
  }

  async getBalance(zsc, shieldedAccountIndex) {
    let shieldedAddress = await this.findShieldedAccount(shieldedAccountIndex);
    if (!shieldedAddress) throw new HttpError(`Shielded account index ${shieldedAccountIndex} can not be located`, 400);

    let shieldedAccounts = await this.walletManager.wallets[WALLET_TYPE.SHIELDED_LOCAL].getAccounts();
    let found = shieldedAccounts.find((sa) => sa.account.isSameAddress(shieldedAddress.shieldedAccount));
    if (!found) throw new HttpError(`Shielded account ${shieldedAddress.shieldedAccount} does not exist in this service locally, can not be used to decrypt balances`, 400);

    let epoch = Math.floor(new Date().getTime() / 1000 / ZSC_EPOCH_LENGTH);
    return await this._getBalance(zsc, found.account, epoch + 1);
  }

  async generateThrowAwayAccount() {
    let index = this.signingAccountIndex++;
    let mnemonic = this.hdWallet.secret;
    logger.info(`Mnemonic ${mnemonic}`);
    let account = await Generator.generateNodes(mnemonic, [index])[0];
    logger.info(`Generate throwaway account, address: ${account.address}, privateKey: ${account.privateKey}`);
    return account;
  }

  async sendTransaction(contractAddress, signer, methodABI, args) {
    let callData = AbiEncoder.encodeFunctionCall(methodABI, args);
    let params = {
      from: signer,
      data: callData,
      to: contractAddress,
      gasPrice: 0,
      value: '0x0',
      gas: this.defaultGas,
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

    let signedTx = await this.walletManager.sign(this.web3, signer, params);
    callTx = this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    return callTx
      .then((response) => {
        return response.contractAddress || response;
      })
      .catch(async (e) => {
        logger.error('Error while deploying contract or sending transaction', e);
        throw e;
      });
  }
}

function invertGBalance(gBalance) {
  var accumulator = bn128.zero;
  for (var i = 0; i < bn128.B_MAX; i++) {
    if (accumulator.eq(gBalance)) {
      return i;
    }
    accumulator = accumulator.add(bn128.curve.g);
  }
  throw new Error(`Can't invert gBalance to Balance`);
}

function _locateFunctionOrEvent(abi, functionName) {
  let func = abi.filter((e) => {
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
