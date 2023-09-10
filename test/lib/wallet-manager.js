'use strict';

const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const { join } = require('path');
const os = require('os');
const fs = require('fs-extra');
const { signTransaction } = require('../../lib/utils');

describe('wallet-manager.js', () => {
  let tmpdir, wm, account, HDWallet;

  before(() => {
    tmpdir = join(os.tmpdir(), 'wallet-manager-test');
    fs.ensureDirSync(tmpdir);
    delete require.cache[require.resolve('../../lib/keystore/hdwallet')];
    delete require.cache[require.resolve('../../lib/wallet-manager')];
    delete require.cache[require.resolve('../../lib/config')];

    process.env.DATA_DIR = tmpdir;
    const WalletManager = require('../../lib/wallet-manager');
    HDWallet = require('../../lib/keystore/hdwallet').HDWallet;
    wm = new WalletManager();
  });

  after(() => {
    fs.removeSync(tmpdir);
  });

  it('init() returns successfully', async () => {
    await wm.init();
    expect(wm.keysdb).to.not.be.undefined;
  });

  it('newAccount() returns successfully', async () => {
    const wallet = new HDWallet('test-1');
    await wallet.init();
    wm.addWallet('test-1', wallet);
    account = await wm.newAccount('test-1');
    expect(account).to.be.an('object').that.has.property('address');
    expect(account).to.be.an('object').that.has.property('privateKey');
  });

  it('sign() returns successfully', async () => {
    await expect(wm.sign(account.address, {})).to.not.throw;
  });
});
