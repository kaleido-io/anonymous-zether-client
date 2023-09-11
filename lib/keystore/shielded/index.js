'use strict';

const fs = require('fs-extra');
const { join } = require('path');
const { promisify } = require('util');
const crypto = require('crypto');
const scrypt = promisify(crypto.scrypt);
const Web3Utils = require('web3-utils');
const uuid = require('uuid');
const BN = require('bn.js');

const { getLogger, HttpError, atomicRW } = require('../../utils');
const bn128Utils = require('@anonymous-zether/anonymous.js/src/utils/utils.js');
const bn128 = require('@anonymous-zether/anonymous.js/src/utils/bn128.js');
const Prover = require('./prover.js');
const logger = getLogger();
const { getDataDir } = require('../../config.js');
const { ZKP_PROTOCOL_MULTIPLIER, ETH_SHIELD_ACCOUNT_MAPPING } = require('../../constants.js');

const CONSENSUS_PROTOCOL = process.env.CONSENSUS || 'qbft';
const KEYSTORE_VER = 1;

// supports the wallet interface based on a locally saved shielded wallet file
// a local shielded wallet can support one or more accounts, each corresponding to
// a bn128 curve based account file. The password file is saved in the parent folder
// named after the address with .password extension
// \_ <address1>.password
// \_ <address2>.password
// \_ keystore
//      \_ UTC--<timestamp>-<address1>
//      \_ UTC--<timestamp>-<address2>
//
class ShieldedAccount {
  constructor() {
    this.dataDir = getDataDir();
    this.storeDir = join(this.dataDir, 'shielded-keystore');
    this.multiplier = CONSENSUS_PROTOCOL === 'raft' ? ZKP_PROTOCOL_MULTIPLIER.RAFT : ZKP_PROTOCOL_MULTIPLIER.QBFT;
    return this;
  }

  // create a shielded account for the ethereum account
  async createAccount(ethereumAccountAddress) {
    // generate a shielded account
    let newAccount = await this.generateAccount();
    let shieldedAccount = bn128.serialize(newAccount.account.address);
    // Write the mapping between shielded account and ethereum account addresses to a local file
    let mappings;
    try {
      await atomicRW(async () => {
        const mappingFile = join(this.dataDir, ETH_SHIELD_ACCOUNT_MAPPING);
        try {
          mappings = JSON.parse(await fs.readFile(mappingFile));
        } catch (err) {
          if (!fs.existsSync(mappingFile)) {
            // 1st time here
            logger.warn(`eth-shielded address mapping file ${mappingFile} doesn't exist yet`);
            mappings = [];
          } else {
            logger.error(`eth-shielded address mapping file ${mappingFile} failed to parse`);
            throw new Error(`Failed while reading local eth-shield mappings`);
          }
        }
        // hold this in an array since we could potentially have multiple shielded accounts
        // per ethereum account address
        mappings.push({ ethAccount: ethereumAccountAddress, shieldedAccount });
        try {
          await fs.writeFile(mappingFile, JSON.stringify(mappings));
        } catch (err) {
          logger.error(`eth-shielded address mapping file ${mappingFile} not found`);
          throw new Error(`Failed while writing to local eth-shield mappings file`);
        }
      });
    } catch (err) {
      throw new HttpError(`Failed while reading or writing to local eth-shield mappings file`);
    }

    return shieldedAccount;
  }

  async findShieldedAccount(ethAddress) {
    let accountMappings = [];
    await atomicRW(async () => {
      try {
        accountMappings = JSON.parse(await fs.readFile(join(this.dataDir, ETH_SHIELD_ACCOUNT_MAPPING)));
      } catch (err) {
        logger.warn(`Accounts mapping file ${join(this.dataDir, ETH_SHIELD_ACCOUNT_MAPPING)} not found`);
      }
    });

    const mapping = accountMappings.find((accountPair) => accountPair.ethAccount.address === ethAddress);
    return mapping && mapping.shieldedAccount;
  }

  // shieldedAccount - the array of the coordinates of the Point for y, aka the public key
  async loadAccountByPublicKey(shieldedAccount) {
    const keyFiles = await fs.readdir(this.storeDir);
    for (let keyfile of keyFiles) {
      if (keyfile.endsWith(shieldedAccount + '')) {
        return await this.loadAccount(join(this.storeDir, keyfile));
      }
    }
    return null;
  }

  async loadAccount(file) {
    // based on wallet file naming convention, parse out the address
    // UTC--2019-08-15T04-03-37.165Z-0x1139f62aa4306102f95d489879361e93b9a1cf72a50dd47d8fda43d95c7abf25,0x09a32fb5a99cf743f2c4f40585f45637ff7e65a9fdbcbfe24615554d9e445f1b
    // the two "0x" hex strings are the two parts of the public key
    let address;
    let matches = file.match(/-(0x[a-f0-9]{64}),(0x[a-f0-9]{64})$/);
    if (matches) {
      address = [matches[1], matches[2]];
    } else {
      logger.error(`File does not appear to have been properly named: ${file}`);
      throw new Error(`File name for Shielded wallets must follow proper naming convention`);
    }

    let passwordPath = join(this.storeDir, `${address}.password`);
    let encryptedAccount, password;

    try {
      let data = await fs.readFile(file);
      encryptedAccount = JSON.parse(data);

      password = await fs.readFile(passwordPath);
    } catch (err) {
      logger.error('Failed to read wallet or password file', err);
      throw err;
    }

    let decrypted = await decrypt(encryptedAccount, password);
    return {
      account: new Prover(decrypted.privateKey, decrypted.publicKey),
      keyFile: file,
      passwordFile: passwordPath,
    };
  }

  async getAccounts() {
    let mappings = [];
    await atomicRW(async () => {
      const mappingFile = join(this.dataDir, ETH_SHIELD_ACCOUNT_MAPPING);
      try {
        let content = await fs.readFile(mappingFile);
        mappings = JSON.parse(content);
        // add index to the entry in order to help identify the shielded account for retrieving balances
        // note that only the local accounts get an index, because getting the balance requires the private
        // key to decrypt the returned balance payload
        mappings = mappings.map((m, idx) => Object.assign({ index: idx }, m));
      } catch (err) {
        logger.warn(`eth-shielded addresses mappings file ${mappingFile} not found`);
      }
    });
    logger.info(mappings);
    return mappings;
  }

  async generateAccount() {
    let account = bn128Utils.createAccount();

    let password = generatePassword();
    let encryptedAccount = await encrypt(account, password);

    logger.info('Generated new account');

    try {
      await fs.ensureDir(this.storeDir);

      logger.info(`Writing wallet for address ${encryptedAccount.address}`);
      let filename = `UTC--${new Date().toISOString().replace(/:/g, '-')}-${encryptedAccount.address}`;
      let keyfile = join(this.storeDir, filename);
      await fs.writeFile(keyfile, JSON.stringify(encryptedAccount));
      let passwordfile = join(this.storeDir, `${encryptedAccount.address}.password`);
      logger.info(`Writing ${passwordfile}`);
      await fs.writeFile(passwordfile, password);
      return {
        account: new Prover(account.x, account.y),
        keyFile: keyfile,
        passwordFile: passwordfile,
      };
    } catch (e) {
      logger.error('Error while writing wallet file', e);
      throw e;
    }
  }
}

function generatePassword() {
  return crypto.randomBytes(8).toString('hex');
}

// Taken from https://github.com/ethereumjs/ethereumjs-wallet
async function encrypt(account, password) {
  let privateKey = account.x;
  const publicKey = bn128.serialize(account.y);
  /* istanbul ignore else */
  if (privateKey.red != null) {
    // if privateKey is in reduced form, get the original Big number
    privateKey = privateKey.fromRed();
  }
  // change it to hex before: optional
  var privateKeyHex = bn128.bytes(privateKey); // TODO: check padding issues if any
  var salt = crypto.randomBytes(32);
  var iv = crypto.randomBytes(16);

  var derivedKey;
  var kdf = 'scrypt';
  var kdfparams = {
    dklen: 32,
    salt: salt.toString('hex'),
  };

  // FIXME: support progress reporting callback
  kdfparams.n = 8192; // 2048 4096 8192 16384
  kdfparams.r = 8;
  kdfparams.p = 1;
  const options = {
    cost: kdfparams.n,
    blockSize: kdfparams.r,
    parallelization: kdfparams.p,
  };
  derivedKey = await scrypt(Buffer.from(password), salt, kdfparams.dklen, options);

  var cipher = crypto.createCipheriv('aes-128-ctr', derivedKey.slice(0, 16), iv);
  /* istanbul ignore next */
  if (!cipher) {
    throw new Error('Unsupported cipher');
  }

  var ciphertext = Buffer.concat([cipher.update(Buffer.from(privateKeyHex.slice(2), 'hex')), cipher.final()]);

  var mac = Web3Utils.sha3(Buffer.concat([derivedKey.slice(16, 32), Buffer.from(ciphertext, 'hex')])).replace('0x', '');

  return {
    version: KEYSTORE_VER,
    id: uuid.v4({ random: crypto.randomBytes(16) }),
    address: publicKey,
    crypto: {
      ciphertext: ciphertext.toString('hex'),
      cipherparams: {
        iv: iv.toString('hex'),
      },
      cipher: 'aes-128-ctr',
      kdf: kdf,
      kdfparams: kdfparams,
      mac: mac.toString('hex'),
    },
  };
}

// Taken from https://github.com/ethereumjs/ethereumjs-wallet
async function decrypt(keystore, password) {
  if (!password) {
    throw new Error('No password given.');
  }

  if (keystore.version !== KEYSTORE_VER) {
    throw new Error(`Not a valid wallet version. Supported version: ${KEYSTORE_VER}`);
  }

  var derivedKey;
  var kdfparams;
  if (keystore.crypto.kdf === 'scrypt') {
    kdfparams = keystore.crypto.kdfparams;
    const options = {
      cost: kdfparams.n,
      blockSize: kdfparams.r,
      parallelization: kdfparams.p,
    };
    derivedKey = await scrypt(password, Buffer.from(kdfparams.salt, 'hex'), kdfparams.dklen, options);
  } else {
    throw new Error('Unsupported key derivation scheme');
  }

  var ciphertext = Buffer.from(keystore.crypto.ciphertext, 'hex');

  var mac = Web3Utils.sha3(Buffer.concat([derivedKey.slice(16, 32), ciphertext])).replace('0x', '');
  if (mac !== keystore.crypto.mac) {
    throw new Error('Key derivation failed - possibly wrong password');
  }

  var decipher = crypto.createDecipheriv(keystore.crypto.cipher, derivedKey.slice(0, 16), Buffer.from(keystore.crypto.cipherparams.iv, 'hex'));
  var seed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const privateKey = new BN(seed, 16).toRed(bn128.q);
  const publicKey = bn128.curve.g.mul(privateKey);
  return { privateKey, publicKey };
}

ShieldedAccount.fs = fs;
module.exports = ShieldedAccount;
