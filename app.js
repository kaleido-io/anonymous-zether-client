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

const express = require('express');
const jsonBodyParser = require('body-parser').json();
const cors = require('cors');
const app = express();
const apiRouter = new express.Router();

const { contentType, requestLogger, expressify } = require('./middleware');
const { HDWallet } = require('./lib/keystore/hdwallet');
const ShieldedWallet = require('./lib/keystore/shielded');
const TradeManager = require('./lib/trade-manager');
const WalletManager = require('./lib/wallet-manager');
const { HttpError, getLogger, isEthereumAddress, isShieldedAddress } = require('./lib/utils');
const Config = require('./lib/config');

// the users wallet dispenses new Ethereum signing accounts to assign to app users
const usersWallet = new HDWallet('users');
// the shielded wallet manages the ElGamal private keys on disk
const shieldedWallet = new ShieldedWallet();
// the wallet manager manages the various Ethereum wallets
const walletManager = new WalletManager();
// the trade manager manages interactions with the cash token and anonymous zether token contracts
const tradeManager = new TradeManager(walletManager, shieldedWallet);

const logger = getLogger();

const PORT = 3000;

// the /api/v1 endpoints will be protected by basic auth with app credentials
// enforced at the nginx
app.use('/api/v1', contentType, cors(), jsonBodyParser, requestLogger, apiRouter);

apiRouter.get('/accounts', expressify(getAccounts, getHandler));
apiRouter.post('/accounts', expressify(newAccount, postHandler));
apiRouter.get('/accounts/:account', expressify(accountStatus, getHandler));
apiRouter.post('/accounts/:account/authorize', expressify(authorizeAccount, postHandler));
apiRouter.post('/accounts/:account/revoke', expressify(revokeAccount, postHandler));
apiRouter.get('/accounts/:account/balance', expressify(getBalance, getHandler));
apiRouter.get('/accounts', expressify(getAccounts, getHandler));
apiRouter.post('/mint', expressify(mint, postHandler));
apiRouter.post('/burn', expressify(burn, postHandler));
apiRouter.post('/move', expressify(move, postHandler));
apiRouter.post('/moveAndBurn', expressify(moveAndBurn, postHandler));
apiRouter.post('/increaseFrozenBalance', expressify(increaseFrozenBalance, postHandler));
apiRouter.post('/decreaseFrozenBalance', expressify(decreaseFrozenBalance, postHandler));
apiRouter.post('/fund', expressify(fund, postHandler));
apiRouter.post('/transfer', expressify(transfer, postHandler));
apiRouter.post('/withdraw', expressify(withdraw, postHandler));

async function getAccounts() {
  const local = await shieldedWallet.getAccounts();
  const shieldedAccounts = await tradeManager.zetherTokenClient.getRegisteredAccounts();
  return { local, onchain: { shieldedAccounts } };
}

async function newAccount(req) {
  const { name } = req.body;
  if (!name) {
    throw new HttpError('Must provide "name" for the account to create and register', 400);
  }
  const ethAccount = await walletManager.newAccount('users');
  await tradeManager.cashTokenClient.enableAccount(ethAccount.address);
  const shieldedAccount = await shieldedWallet.createAccount(ethAccount.address);
  await tradeManager.zetherTokenClient.registerAccount(ethAccount.address, name);
  return { eth: ethAccount.address, shielded: shieldedAccount };
}

async function authorizeAccount(req) {
  const ethAddress = req.params.account;
  const txHash = await tradeManager.cashTokenClient.enableAccount(ethAddress);
  return {
    success: true,
    transactionHash: txHash,
  };
}

async function accountStatus(req) {
  const address = req.params.account;
  const status = {};
  if (isEthereumAddress(address)) {
    // query for the ERC20 authorized status
    status.isEthereumAddress = true;
    status.isAuthorized = await tradeManager.cashTokenClient.isAuthorized(address);
  } else {
    throw new HttpError('Unknown address format', 400);
  }
  return status;
}

async function revokeAccount(req) {
  const ethAddress = req.params.account;
  const txHash = await tradeManager.cashTokenClient.disableAccount(ethAddress);
  return {
    success: true,
    transactionHash: txHash,
  };
}

async function getBalance(req) {
  const address = req.params.account;
  let balance;
  if (isEthereumAddress(address)) {
    // query for the ERC20 balance
    balance = await tradeManager.cashTokenClient.getBalance(address);
  } else if (isShieldedAddress(address)) {
    // query for the Zether balance
    const shieldedAddress = address.split(',');
    balance = await tradeManager.zetherTokenClient.getBalance(shieldedAddress);
  } else {
    throw new HttpError('Unknown address format', 400);
  }
  return { balance };
}

async function mint(req) {
  const { ethAddress, amount } = req.body;
  if (!ethAddress) {
    throw new HttpError('Must provide "ethAddress" for the account to mint tokens to', 400);
  }
  if (!amount) {
    throw new HttpError('Must provide "amount" for the minting amount', 400);
  }
  const txHash = await tradeManager.cashTokenClient.mint(ethAddress, amount);
  return {
    success: true,
    transactionHash: txHash,
  };
}

async function burn(req) {
  const { ethAddress, amount } = req.body;
  if (!amount) {
    throw new HttpError('Must provide "amount" for the burning amount', 400);
  }
  let txHash;
  if (ethAddress) {
    txHash = await tradeManager.cashTokenClient.burnFrom(ethAddress, amount);
  } else {
    txHash = await tradeManager.cashTokenClient.burn(amount);
  }

  return {
    success: true,
    transactionHash: txHash,
  };
}

async function move(req) {
  const { senderEthAddress, receiverEthAddress, amount } = req.body;
  if (!senderEthAddress) {
    throw new HttpError('Must provide "senderEthAddress" for the signing address to transfer fund from', 400);
  }
  if (!receiverEthAddress) {
    throw new HttpError('Must provide "receiverEthAddress" for the signing address to send fund to', 400);
  }
  if (!amount) {
    throw new HttpError('Must provide "amount" for the transfer amount', 400);
  }
  const txHash = await tradeManager.cashTokenClient.move(senderEthAddress, receiverEthAddress, amount);
  return {
    success: true,
    transactionHash: txHash,
  };
}

async function moveAndBurn(req) {
  const { ethAddress, amount } = req.body;
  if (!ethAddress) {
    throw new HttpError('Must provide "ethAddress" for the account to burn tokens from', 400);
  }
  if (!amount) {
    throw new HttpError('Must provide "amount" for the bruning amount', 400);
  }
  const txHash = await tradeManager.cashTokenClient.moveAndBurn(ethAddress, amount);
  return {
    success: true,
    transactionHash: txHash,
  };
}

async function increaseFrozenBalance(req) {
  const { ethAddress, amount } = req.body;
  if (!ethAddress) {
    throw new HttpError('Must provide "ethAddress" for the account to increase the frozen balance of', 400);
  }
  if (!amount) {
    throw new HttpError('Must provide "amount" for the increasing amount', 400);
  }
  const txHash = await tradeManager.cashTokenClient.increaseFrozenBalance(ethAddress, amount);
  return {
    success: true,
    transactionHash: txHash,
  };
}

async function decreaseFrozenBalance(req) {
  const { ethAddress, amount } = req.body;
  if (!ethAddress) {
    throw new HttpError('Must provide "ethAddress" for the account to decrease the frozen balance of', 400);
  }
  if (!amount) {
    throw new HttpError('Must provide "amount" for the increasing amount', 400);
  }
  const txHash = await tradeManager.cashTokenClient.decreaseFrozenBalance(ethAddress, amount);
  return {
    success: true,
    transactionHash: txHash,
  };
}

async function fund(req) {
  const { ethAddress, amount } = req.body;
  if (!ethAddress) {
    throw new HttpError('Must provide "ethAddress" for the signing address to draw fund from', 400);
  }
  if (!amount) {
    throw new HttpError('Must provide "amount" for the funding amount', 400);
  }
  const txHash = await tradeManager.zetherTokenClient.fundAccount(ethAddress, amount);
  return {
    success: true,
    transactionHash: txHash,
  };
}

async function transfer(req) {
  const { sender, receiver, amount } = req.body;
  if (!isShieldedAddress(sender)) {
    throw new HttpError('Must provide "sender" in shielded address format for the sender address', 400);
  }
  if (!isShieldedAddress(receiver)) {
    throw new HttpError('Must provide "receiver" in shielded address format for the receiver address', 400);
  }
  const shieldedSenderAddress = sender.split(',');
  const shieldedReceiverAddress = receiver.split(',');
  if (!amount) {
    throw new HttpError('Must provide "amount" for the transfer amount', 400);
  }
  const txHash = await tradeManager.zetherTokenClient.transfer(shieldedSenderAddress, shieldedReceiverAddress, amount);
  return {
    success: true,
    transactionHash: txHash,
  };
}

async function withdraw(req) {
  const { ethAddress, amount } = req.body;
  if (!isEthereumAddress(ethAddress)) {
    throw new HttpError('Must provide the "ethAddress" for the ethereum address to withdraw funds to', 400);
  }
  if (!amount) {
    throw new HttpError('Must provide "amount" for the withdraw amount', 400);
  }
  const txHash = await tradeManager.zetherTokenClient.withdraw(ethAddress, amount);
  return {
    success: true,
    transactionHash: txHash,
  };
}

function postHandler(req, res, result) {
  // eslint-disable-line no-unused-vars
  res.status(201);
  res.header('Content-Type', 'application/json');
  res.send(JSON.stringify({ ...result }, null, 2));
}

function getHandler(req, res, result) {
  res.status(200);
  res.header('Content-Type', 'application/json');
  res.send(JSON.stringify(result, null, 2));
}

function printConfig() {
  logger.info('Configurations:');
  logger.info(`\t    data dir: ${Config.getDataDir()}`);
  logger.info(`\t     eth URL: ${Config.getEthUrl()}`);
  logger.info(`\t    chain ID: ${Config.getChainId()}`);
  logger.info(`\t       erc20: ${Config.getERC20Address()}`);
  logger.info(`\t         ZSC: ${Config.getZSCAddress()}`);
  logger.info(`\tepoch length: ${Config.getEpochLength()} seconds`);
}

const serverPromise = tradeManager
  .init()
  .then(async () => {
    await walletManager.init();
    await usersWallet.init();
    walletManager.addWallet('users', usersWallet);
  })
  .then(() => {
    printConfig();
    return app.listen(PORT, () => logger.info('Listening on port ' + PORT));
  });

module.exports = {
  app,
  serverPromise,
  tradeManager,
};
