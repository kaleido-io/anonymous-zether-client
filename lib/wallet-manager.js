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

const { open } = require('lmdb');
const { join } = require('path');
const Config = require('./config');
const { getLogger, signTransaction } = require('./utils');
const Admin = require('./keystore/admin');
const logger = getLogger();

const KEY_DOCS_COUNT = 'docs-count';

// simple implementation of an Ethereum wallet manager that can dispense new signing accounts
// and can sign transactions. It uses a simple interface for supported wallet implementations:
// - newAccount()
// - sign()
class EthWalletManager {
  constructor() {
    this.dataDir = Config.getDataDir();
    this.wallets = {};
  }

  async init() {
    const dbPath = join(this.dataDir, 'keysdb');
    this.keysdb = await open({
      path: dbPath,
      compression: true,
    });
    logger.info(`Successfully opened connection to key DB at ${dbPath}`);
  }

  addWallet(name, wallet) {
    this.wallets[name] = wallet;
  }

  async newAccount(walletName) {
    let account;
    await this.keysdb.transaction(async () => {
      // maintains a per-wallet key counter
      const key = `${KEY_DOCS_COUNT}-${walletName}`;
      let count = await this.keysdb.get(key);
      if (!count) {
        // first time querying for this wallet, the keys count entry has not been created
        count = 0;
      }
      account = await this.wallets[walletName].getAccount(count);
      await this.keysdb.put(account.address, account.privateKey);
      await this.keysdb.put(key, count + 1);
    });
    return account;
  }

  async sign(web3, address, payload, isAdminSigner) {
    let signer;
    if (isAdminSigner) {
      signer = Admin.getAccount(web3);
    } else {
      const privateKey = await this.keysdb.get(address);
      if (!privateKey) {
        logger.error(`Signing address ${address} does not exist in the key DB`);
        throw new Error(`Signing address ${address} does not exist in the key DB`);
      }
      signer = { address, privateKey };
    }
    return await signTransaction(web3, payload, signer);
  }
}

module.exports = EthWalletManager;
