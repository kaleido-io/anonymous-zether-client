'use strict';

const chai = require('chai');
const sinon = require('sinon');
chai.use(require('sinon-chai'));
const expect = chai.expect;
const nock = require('nock');
const { join } = require('path');
const { homedir } = require('os');

const { HDWallet } = require('../../../../lib/keystore/hdwallet/index.js');
const SecretStore = HDWallet.SecretStore;

describe('hdwallet', () => {
  const storeDir = join(homedir(), 'zether/hdwallet-secret-store');
  beforeEach(() => {
    sinon.stub(SecretStore.fs, 'access').resolves();
    sinon.stub(SecretStore.fs, 'ensureDir').resolves();
    sinon.stub(SecretStore.fs, 'readFile').resolves();
    sinon.stub(SecretStore.fs, 'writeFile').resolves();
    sinon.stub(SecretStore.fs, 'readdir').resolves([]);
    sinon.stub(SecretStore.fs, 'remove').resolves();
  });

  afterEach(() => {
    SecretStore.fs.access.restore();
    SecretStore.fs.readFile.restore();
    SecretStore.fs.writeFile.restore();
    SecretStore.fs.ensureDir.restore();
    SecretStore.fs.readdir.restore();
    SecretStore.fs.remove.restore();
  });

  describe('SecretStore', () => {
    it('creates a new instance and initialize it with default location', async () => {
      let store = new SecretStore();
      await store.init();

      expect(SecretStore.fs.ensureDir).calledWith(storeDir);
    });

    it('adds a new secret without a mnemonic and returns a 12-word mnemonic', async () => {
      let store = new SecretStore();
      await store.init();
      let result = await store.addWallet('test-1');

      expect(result.id).to.equal('test-1');
      expect(result.secret).to.match(/([a-z]+ ){11}[a-z]+/);
    });

    it('gets all existing secrets', async () => {
      SecretStore.fs.readdir.resolves(['test-1.wallet', 'test-2.wallet']);

      let store = new SecretStore();
      await store.init();
      let result = await store.getWallets();

      expect(result).to.deep.equal(['test-1', 'test-2']);
    });

    it('gets an existing secret', async () => {
      SecretStore.fs.readdir.resolves(['dummyId.wallet']);
      SecretStore.fs.readFile.withArgs(join(storeDir, 'dummyId.wallet')).resolves('some secret string');

      let store = new SecretStore();
      await store.init();
      let result = await store.getWallet('dummyId');

      expect(result).to.deep.equal({ id: 'dummyId', secret: 'some secret string' });
    });

    it('throws when trying to delete a non-existent secret', async () => {
      SecretStore.fs.access.rejects();

      let store = new SecretStore();
      await store.init();

      try {
        await store.deleteSecret('dummyId');
        expect.fail();
      } catch (err) {
        expect(err).to.be.an('error');
        expect(err).to.match(/Failed to delete secret for the provided ID: the secret does not exist/);
      }
    });

    it('deletes a secret', async () => {
      SecretStore.fs.access.resolves();
      SecretStore.fs.remove.withArgs(join(storeDir, 'dummyId')).resolves();

      let store = new SecretStore();
      await store.init();
      await store.deleteSecret('dummyId');

      expect(SecretStore.fs.remove).calledWith(join(storeDir, 'dummyId'));
    });
  });

  describe('HDWallet', () => {
    it('init()', async () => {
      const wallet = new HDWallet('test-1');
      await wallet.init();
      expect(wallet.generator).not.undefined;
    });

    it('getAccount()', async () => {
      const wallet = new HDWallet('test-2');
      await wallet.init();
      let signers = await wallet.getAccount(0);
      expect(signers).to.be.an('object').that.has.property('address');
      expect(signers).to.be.an('object').that.has.property('privateKey');
    });
  });
});
