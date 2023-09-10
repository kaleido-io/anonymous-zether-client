'use strict';

const BIP39 = require('bip39');
const HDKey = require('hdkey');
const ethUtil = require('ethereumjs-util');
const { getLogger, HttpError } = require('../../utils');
const logger = getLogger();

// standard HD Wallet derivation path for Ethereum accounts
// 44 — BIP 44 Purpose
// 60 — Ethereum’s coin type
// 0 — Account 0
// 0 — Chain 0
// https://github.com/ethereum/EIPs/issues/84#issue-143651804
const HD_PATH_ETH = "m/44'/60'/0'/0";

async function rootFromMnemonic(mnemonic) {
  const seed = await BIP39.mnemonicToSeed(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  return root;
}

function privateKeyToAddress(privateKey) {
  const pubKey = ethUtil.privateToPublic(privateKey);
  const account = ethUtil.publicToAddress(pubKey).toString('hex');
  const address = ethUtil.toChecksumAddress('0x' + account);
  return address;
}

class Generator {
  constructor(mnemonic) {
    this.mnemonic = mnemonic;
  }

  async getRoot() {
    if (!this.root) {
      this.root = await rootFromMnemonic(this.mnemonic);
    }
    return this.root;
  }

  async generateNodes(range) {
    const root = await this.getRoot();
    let ret = [];
    for (let idx of range) {
      try {
        let accountNode = root.derive(`${HD_PATH_ETH}/${idx}`);
        let address = privateKeyToAddress(accountNode._privateKey);

        ret.push({
          // returned in Ethereum address format convention with '0x' prefix
          address: address,
          // returned as raw hex string without the '0x' prefix as this is likely
          // to be immediately turned into a byte array to be used by the client
          privateKey: accountNode._privateKey.toString('hex'),
        });
      } catch (err) {
        logger.error(`Failed to generate key at index, ${idx}, ${err}`);
        throw new HttpError(`Invalid index ${idx}`, 400);
      }
    }

    return ret;
  }
}

module.exports = Generator;
