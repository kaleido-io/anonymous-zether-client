'use strict';

const Accounts = require('./keystore/shielded');
const { getLogger, HttpError } = require('./utils');

const accounts = new Accounts();
const logger = getLogger();

async function createAccount(req) {
  // eslint-disable-line no-unused-vars
  let ethereumAccountAddress = req.body.ethAccount;
  if (!ethereumAccountAddress) {
    logger.err(`Missing ethereum account address in request`);
    throw new HttpError(`Parameter ethAccount required to create shielded account`, 400);
  }
  if (!checkEthAddress(ethereumAccountAddress)) {
    logger.err(`ethereum account address ${ethereumAccountAddress} in request is not well formed`);
    throw new HttpError(`ethereum account address in request is not well formed`, 400);
  }
  return await accounts.createAccount(ethereumAccountAddress.toLowerCase());
}

async function getAccounts(req) {
  // eslint-disable-line no-unused-vars
  return await accounts.getAccounts();
}

async function fundAccount(contract_id, req) {
  let { ethAccount, amount } = req.body;
  if (!ethAccount) {
    logger.err(`Missing Account address holding ERC20 tokens`);
    throw new HttpError(`Missing required parameter "ethAccount"`, 400);
  }
  if (!checkEthAddress(ethAccount)) {
    logger.err(`ethereum account address ${ethAccount} in request is not well formed`);
    throw new HttpError(`ethereum account address in request is not well formed`, 400);
  }
  if (!amount) {
    logger.err(`Missing required parameter "amount" ${amount}`);
    throw new HttpError(`Missing required parameter "amount"`, 400);
  }
  return await tradeManager.fundAccount(contract_id, ethAccount.toLowerCase(), amount);
}

async function transfer(contract_id, req) {
  let { from, to, amount, decoys } = req.body;
  if (!from) {
    logger.err(`Missing values for from`);
    throw new HttpError(`Missing required parameter "from"`, 400);
  }
  if (!checkShieldedAddress(from)) {
    logger.err(`from ${from} is not well formed`);
    throw new HttpError(`from is not well formed`, 400);
  }
  if (!to) {
    logger.err(`Missing values for to`);
    throw new HttpError(`Missing required parameter "to"`, 400);
  }
  if (!checkShieldedAddress(to)) {
    logger.err(`to ${from} is not well formed`);
    throw new HttpError(`to is not well formed`, 400);
  }
  if (!amount) {
    logger.err(`Missing values for amount`);
    throw new HttpError(`Missing required parameter "amount"`, 400);
  }

  if (decoys) {
    let anonSetSize = decoys.length + 2;
    /* istanbul ignore else */
    if ((anonSetSize & (anonSetSize - 1)) != 0) {
      logger.err(`Number of decoy account should be of the form (2^K)-2, for K>0`);
      throw new HttpError(`Number of decoy accounts must be one of 0, 2 or 6`, 400);
    }
    for (var i = 0; i < decoys.length; i++) {
      if (!checkShieldedAddress(decoys[i])) {
        logger.err(`decoy account ${decoys[i]} is not well formed`);
        throw new HttpError(`decoy accounts are not well formed`, 400);
      }
    }
  } else {
    decoys = [];
  }

  return await tradeManager.transfer(contract_id, from, to, amount, decoys);
}

async function withdraw(contract_id, req) {
  let { ethAccount, shieldedAccount, amount } = req.body;
  if (!ethAccount) {
    logger.err(`Missing ethereum Account address holding shielded tokens`);
    throw new HttpError(`Missing required parameter "ethAccount"`, 400);
  }
  if (!checkEthAddress(ethAccount)) {
    logger.err(`eth account ${ethAccount} is not well formed`);
    throw new HttpError(`eth account is not well formed`, 400);
  }
  if (shieldedAccount && !checkShieldedAddress(shieldedAccount)) {
    logger.err(`shielded account ${shieldedAccount} is not well formed`);
    throw new HttpError(`shielded account is not well formed`, 400);
  }
  if (!amount) {
    logger.err(`Missing amount`);
    throw new HttpError(`Missing required parameter "amount"`, 400);
  }

  return await tradeManager.withdraw(contract_id, ethAccount, shieldedAccount, amount);
}

async function getBalance(contractId, shieldedAccountIndex) {
  return {
    result: await tradeManager.getBalance(contractId, shieldedAccountIndex),
  };
}

//checks if ethereum Address is well formed
function checkEthAddress(ethAdress) {
  return ethAdress.match(/^0x[0-9a-fA-F]{40}$/);
}

//checks if shielded Address is well formed
function checkShieldedAddress(shieldedAddress) {
  return Array.isArray(shieldedAddress) && shieldedAddress.length == 2 && shieldedAddress[0].match(/^0x[0-9a-f]{64}$/) && shieldedAddress[1].match(/^0x[0-9a-f]{64}$/);
}

module.exports = {
  createAccount,
  getAccounts,
  fundAccount,
  transfer,
  withdraw,
  getBalance,
};
