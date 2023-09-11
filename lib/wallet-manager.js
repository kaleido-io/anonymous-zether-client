'use strict';

const { open } = require('lmdb');
const { join } = require('path');
const Config = require('./config');
const { getLogger, signTransaction } = require('./utils');
const Admin = require('./keystore/admin');
const logger = getLogger();

const KEY_DOCS_COUNT = 'docs-count';

// simple implementation of a wallet manager that can dispense new signing accounts
// and can sign transactions. It uses a simple interface for supported wallet implementations:
// - newAccount()
// - sign()
class WalletManager {
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
        logger.error(`Signined address ${address} does not exist in the key DB`);
        throw new Error(`Signined address ${address} does not exist in the key DB`);
      }
      signer = { address, privateKey };
    }
    return await signTransaction(web3, payload, signer);
  }
}

module.exports = WalletManager;
