'use strict';

const { join, basename } = require('path');
const fs = require('fs-extra');
const BIP39 = require('bip39');

const { getLogger, HttpError } = require('../../utils');
const { getDataDir } = require('../../config');
const Generator = require('./generator.js');
const logger = getLogger();

const WALLET_NAME_ONETIME_SIGNERS = 'onetime-use-signers';

class HDWallet {
  constructor (name) {
    if (!name) {
      throw new Error('Must provide a name for the HD Wallet');
    }
    this.name = name;
    this.store = new SecretStore();
  }

  // ensure we have the hd wallet seed phrase
  async init () {
    await this.store.init();
    let wallet = await this.store.getWallet(this.name);
    if (!wallet) {
      wallet = await this.store.addWallet(this.name);
    }
    this.generator = new Generator(wallet.secret);
  }

  async getAccount (index) {
    return (await this.generator.generateNodes([index]))[0];
  }
}

class OneTimeSignersWallet extends HDWallet {
  constructor () {
    super(WALLET_NAME_ONETIME_SIGNERS);
  }
}

class SecretStore {
  constructor () {
    let folder = getDataDir();
    folder = join(folder, 'hdwallet-secret-store');
    this.dataDir = folder;
  }

  async init () {
    await fs.ensureDir(this.dataDir);
  }

  async getWallets () {
    const existingFiles = await fs.readdir(this.dataDir);
    return existingFiles.map((f) => basename(f, '.wallet'));
  }

  async getWallet (name) {
    const existingFiles = await fs.readdir(this.dataDir);
    const wallet = existingFiles.find((filename) => filename == `${name}.wallet`);
    if (wallet) {
      const content = await fs.readFile(join(this.dataDir, wallet));
      return {
        id: basename(wallet, '.wallet'),
        secret: content.toString()
      };
    }
    return null;
  }

  async addWallet (name) {
    const existing = await this.getWallet(name);
    if (existing) {
      logger.error(`Failed to add new wallet: ${name} already exists`);
      throw new Error(`Failed to add new wallet: ${name} already exists`);
    }
    const secret = BIP39.generateMnemonic();

    const file = join(this.dataDir, `${name}.wallet`);
    await fs.writeFile(file, secret);

    logger.info(`Generated new secret for wallet ID: ${name}`);
    return {
      id: name,
      secret
    };
  }

  async deleteSecret (id) {
    try {
      await fs.access(join(this.dataDir, id), fs.constants.R_OK);
    } catch (err) {
      logger.error(`Failed to delete secret for ID ${id}. ${err}`);
      throw new HttpError('Failed to delete secret for the provided ID: the secret does not exist', 404);
    }

    logger.info(`Deleting secret for ID ${id}`);
    await fs.remove(join(this.dataDir, id));
  }
}

SecretStore.fs = fs;
HDWallet.SecretStore = SecretStore;
module.exports = {
  HDWallet,
  OneTimeSignersWallet
};
