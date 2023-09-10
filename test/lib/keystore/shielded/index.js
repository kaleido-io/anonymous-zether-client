'use strict';

const sinon = require('sinon');
const chai = require('chai');
chai.use(require('sinon-chai'));
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const assert = chai.assert;
const BN = require('bn.js');
const { join } = require('path');
const { ZKP_PROOF_TYPE } = require('../../../../lib/constants.js');
const { ElGamal } = require('@anonymous-zether/anonymous.js/src/utils/algebra.js');
const bn128 = require('@anonymous-zether/anonymous.js/src/utils/bn128.js');
const { ETH_SHIELD_ACCOUNT_MAPPING } = require('../../../../lib/constants.js');

describe('ShieldedAccount', () => {
  let ShieldedWallet,
    wallet,
    // account 1
    testAccount,
    password,
    encryptedAccount,
    keyFile,
    passwordFile,
    // account 2
    testAccount2,
    password2,
    encryptedAccount2,
    keyFile2,
    passwordFile2,
    // decoy accounts
    decoyAddress1,
    decoyAddress2,
    // test encrypted balance
    testBalance,
    encryptedTestBalance_CL,
    encryptedTestRandomness_CR;
  before(async () => {
    ShieldedWallet = require('../../../../lib/keystore/shielded');
  });

  beforeEach(() => {
    sinon.stub(ShieldedWallet.fs, 'writeFile').resolves();
    sinon.stub(ShieldedWallet.fs, 'readFile').resolves();
    sinon.stub(ShieldedWallet.fs, 'ensureDir').resolves();
    sinon.stub(ShieldedWallet.fs, 'readdir').resolves();
    sinon.stub(ShieldedWallet.fs, 'existsSync').resolves();

    wallet = new ShieldedWallet();
  });

  afterEach(() => {
    ShieldedWallet.fs.writeFile.restore();
    ShieldedWallet.fs.readFile.restore();
    ShieldedWallet.fs.ensureDir.restore();
    ShieldedWallet.fs.readdir.restore();
    ShieldedWallet.fs.existsSync.restore();
  });

  describe('generateAccount()', () => {
    it('generateAccount() returns a new account and persists the encrypted key to file', async () => {
      let result = await wallet.generateAccount();
      expect(result).to.be.an('object').that.has.property('account');
      expect(result.account).to.be.an('object').that.has.property('address');
      expect(result.account.address).to.be.an('object');

      const publicKey = bn128.serialize(result.account.address);
      let keyfileRegex = new RegExp(`${wallet.storeDir}/UTC--.*${publicKey}`);
      expect(ShieldedWallet.fs.writeFile).to.be.calledWith(sinon.match(keyfileRegex), sinon.match.string);
      let pwdfileRegex = new RegExp(`${publicKey}.password`);
      expect(ShieldedWallet.fs.writeFile).to.be.calledWith(sinon.match(pwdfileRegex), sinon.match.string);

      testAccount = result.account;
      testBalance = new BN(100, 10);
      let randomness = bn128.randomScalar();
      let pubKey = result.account.address;
      encryptedTestRandomness_CR = bn128.serialize(bn128.curve.g.mul(randomness));
      encryptedTestBalance_CL = bn128.serialize(ElGamal.base['g'].mul(testBalance).add(pubKey.mul(randomness)));
      password = ShieldedWallet.fs.writeFile.getCall(1).args[1];
      encryptedAccount = JSON.parse(ShieldedWallet.fs.writeFile.getCall(0).args[1]);
      keyFile = ShieldedWallet.fs.writeFile.getCall(0).args[0];
      passwordFile = ShieldedWallet.fs.writeFile.getCall(1).args[0];
    });

    it('create testAccount2 as transfer receiver', async () => {
      // add a second account for transfer proof generation
      let result2 = await wallet.generateAccount();
      expect(result2).to.be.an('object').that.has.property('account');
      expect(result2.account).to.be.an('object').that.has.property('address');
      expect(result2.account.address).to.be.an('object');
      const publicKey = bn128.serialize(result2.account.address);
      let keyfileRegex2 = new RegExp(`${wallet.storeDir}/UTC--.*${publicKey}`);
      expect(ShieldedWallet.fs.writeFile).to.be.calledWith(sinon.match(keyfileRegex2), sinon.match.string);
      let pwdfileRegex2 = new RegExp(`${publicKey}.password`);
      expect(ShieldedWallet.fs.writeFile).to.be.calledWith(sinon.match(pwdfileRegex2), sinon.match.string);

      testAccount2 = result2.account;
      password2 = ShieldedWallet.fs.writeFile.getCall(1).args[1];
      encryptedAccount2 = JSON.parse(ShieldedWallet.fs.writeFile.getCall(0).args[1]);
      keyFile2 = ShieldedWallet.fs.writeFile.getCall(0).args[0];
      passwordFile2 = ShieldedWallet.fs.writeFile.getCall(1).args[0];
    });

    it('create 2 decoy accounts', async () => {
      decoyAddress1 = (await wallet.generateAccount()).account.address;
      decoyAddress2 = (await wallet.generateAccount()).account.address;
    });

    it('generateAccount() handles file write errors', async () => {
      ShieldedWallet.fs.writeFile.rejects(new Error('Bang!'));

      await expect(wallet.generateAccount()).to.eventually.be.rejectedWith('Bang!');
    });
  });

  describe('loadAccount()', () => {
    it('loadAccount() recovers an account from encrypted persistence', async () => {
      ShieldedWallet.fs.readFile.withArgs(keyFile).resolves(Buffer.from(JSON.stringify(encryptedAccount)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile).resolves(Buffer.from(password));

      let result = await wallet.loadAccount(keyFile);

      expect(result.account.address).to.deep.equal(testAccount.address);
      expect(testAccount._x.eq(result.account._x)).to.be.true;
    });

    it('loadAccount() handles mal-formated file names', async () => {
      await expect(wallet.loadAccount('bad-file-name')).to.eventually.be.rejectedWith('File name for Shielded wallets must follow proper naming convention');
    });

    it('loadAccount() handles file read errors', async () => {
      ShieldedWallet.fs.readFile.rejects(new Error('Bang!'));

      let name = 'UTC--2019-08-15T04-03-37.165Z-0x1c878db535ddd8090e13e469e3f5b414d5f2cb93ed685c0e2fe8264cdc9dafa8,0x2cccc632929308a5c62c8d97909aec53db0c8241a62c59d3f9093fed02992114';
      await expect(wallet.loadAccount(name)).to.eventually.be.rejectedWith('Bang!');
    });

    it('loadAccount() handles password file read errors', async () => {
      let keyfile = 'UTC--2019-08-15T04-03-37.165Z-0x1c878db535ddd8090e13e469e3f5b414d5f2cb93ed685c0e2fe8264cdc9dafa8,0x2cccc632929308a5c62c8d97909aec53db0c8241a62c59d3f9093fed02992114';
      let passwordfile = '0x1c878db535ddd8090e13e469e3f5b414d5f2cb93ed685c0e2fe8264cdc9dafa8,0x2cccc632929308a5c62c8d97909aec53db0c8241a62c59d3f9093fed02992114.password';
      ShieldedWallet.fs.readFile
        .withArgs(keyfile)
        .resolves(Buffer.from(JSON.stringify(encryptedAccount)))
        .withArgs(passwordfile)
        .resolves(undefined);

      await expect(wallet.loadAccount(keyfile)).to.eventually.be.rejectedWith('No password given.');
    });

    it('loadAccount() handles bad kdf function in keystore object', async () => {
      let badKeyStore = Object.assign({}, encryptedAccount);
      let badCrypto = Object.assign({}, encryptedAccount.crypto);
      badCrypto.kdf = 'bad';
      badKeyStore.crypto = badCrypto;
      ShieldedWallet.fs.readFile.withArgs(keyFile).resolves(Buffer.from(JSON.stringify(badKeyStore)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile).resolves(Buffer.from(password));

      await expect(wallet.loadAccount(keyFile)).to.eventually.be.rejectedWith('Unsupported key derivation scheme');
    });

    it('loadAccount() handles bad version in keystore object', async () => {
      let badKeyStore = Object.assign({}, encryptedAccount);
      badKeyStore.version = 2;
      ShieldedWallet.fs.readFile.withArgs(keyFile).resolves(Buffer.from(JSON.stringify(badKeyStore)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile).resolves(Buffer.from(password));

      await expect(wallet.loadAccount(keyFile)).to.eventually.be.rejectedWith('Not a valid wallet version. Supported version: 1');
    });

    it('loadAccount() handles wrong password', async () => {
      ShieldedWallet.fs.readFile.withArgs(keyFile).resolves(Buffer.from(JSON.stringify(encryptedAccount)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile).resolves(Buffer.from('abc'));

      await expect(wallet.loadAccount(keyFile)).to.eventually.be.rejectedWith('Key derivation failed - possibly wrong password');
    });
  });

  describe('decrypt()', () => {
    it('decrypt(payload) decrypts a balance correctly', async () => {
      ShieldedWallet.fs.readFile.withArgs(keyFile).resolves(Buffer.from(JSON.stringify(encryptedAccount)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile).resolves(Buffer.from(password));

      let result = await wallet.loadAccount(keyFile);

      expect(result.account.address).to.deep.equal(testAccount.address);
      expect(testAccount._x.eq(result.account._x)).to.be.true;

      let gB = result.account.decrypt({ c1: encryptedTestBalance_CL, c2: encryptedTestRandomness_CR });
      let balance;
      var accumulator = bn128.zero;
      for (var i = 0; i < bn128.B_MAX; i++) {
        if (accumulator.eq(gB)) {
          balance = i;
          break;
        }
        accumulator = accumulator.add(bn128.curve.g);
      }
      expect(balance).is.equal(100);
    });

    it('decrypt(payload) handles a malformed ciphertext object, correctly', async () => {
      ShieldedWallet.fs.readFile.withArgs(keyFile).resolves(Buffer.from(JSON.stringify(encryptedAccount)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile).resolves(Buffer.from(password));

      let result = await wallet.loadAccount(keyFile);

      expect(result.account.address).to.deep.equal(testAccount.address);
      expect(testAccount._x.eq(result.account._x)).to.be.true;

      assert.throws(
        function () {
          result.account.decrypt({ failed: encryptedTestBalance_CL, c2: encryptedTestRandomness_CR });
        },
        Error,
        new RegExp(`Decrypt error, Missing values of ciphertext.*`)
      );
    });

    it('decrypt(payload) handles a malformed ciphertext data , correctly', async () => {
      ShieldedWallet.fs.readFile.withArgs(keyFile).resolves(Buffer.from(JSON.stringify(encryptedAccount)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile).resolves(Buffer.from(password));

      let result = await wallet.loadAccount(keyFile);

      expect(result.account.address).to.deep.equal(testAccount.address);
      expect(testAccount._x.eq(result.account._x)).to.be.true;

      assert.throws(
        function () {
          result.account.decrypt({ c1: 23, c2: encryptedTestRandomness_CR });
        },
        Error,
        new RegExp(`Error while deserializing:.*`)
      );
    });
  });

  describe('generateProof()', () => {
    it('generateProof() generates a proof for fund transfer', async () => {
      ShieldedWallet.fs.readFile.withArgs(keyFile).resolves(Buffer.from(JSON.stringify(encryptedAccount)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile).resolves(Buffer.from(password));
      ShieldedWallet.fs.readFile.withArgs(keyFile2).resolves(Buffer.from(JSON.stringify(encryptedAccount2)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile2).resolves(Buffer.from(password2));

      let result = await wallet.loadAccount(keyFile);
      let result2 = await wallet.loadAccount(keyFile2);

      expect(result.account.address).to.deep.equal(testAccount.address);
      expect(testAccount._x.eq(result.account._x)).to.be.true;
      expect(result2.account.address).to.deep.equal(testAccount2.address);
      expect(testAccount2._x.eq(result2.account._x)).to.be.true;

      var data = {};
      var payload = {};
      payload.type = ZKP_PROOF_TYPE.TRANSFER_PROOF;
      data.anonSet = [result.account.address, result2.account.address, decoyAddress1, decoyAddress2];
      data.anonSetStates = [
        [encryptedTestBalance_CL, encryptedTestRandomness_CR],
        [encryptedTestBalance_CL, encryptedTestRandomness_CR],
        [encryptedTestBalance_CL, encryptedTestRandomness_CR],
        [encryptedTestBalance_CL, encryptedTestRandomness_CR],
      ];
      data.randomness = bn128.randomScalar();
      data.value = 50;
      data.index = [0, 1];
      data.balanceAfterTransfer = 50;
      data.epoch = 1;
      payload.args = data;
      let proof = await result.account.generateProof(payload);
      expect(proof).to.be.an('object').that.has.property('data');
    }).timeout(15000);

    it('generateProof() generates a proof for burn', async () => {
      ShieldedWallet.fs.readFile.withArgs(keyFile2).resolves(Buffer.from(JSON.stringify(encryptedAccount2)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile2).resolves(Buffer.from(password2));
      let result2 = await wallet.loadAccount(keyFile2);
      expect(result2.account.address).to.deep.equal(testAccount2.address);
      expect(testAccount2._x.eq(result2.account._x)).to.be.true;

      var payload = {};
      var data = {};
      payload.type = ZKP_PROOF_TYPE.BURN_PROOF;
      data.burnAccount = result2.account.address;
      data.burnAccountState = [encryptedTestBalance_CL, encryptedTestRandomness_CR];
      data.value = 50;
      data.balanceAfterTransfer = 50;
      data.epoch = 1;
      data.sender = '0x1cd89e376b23ac5e51b249aa9192003f1dd17941';
      payload.args = data;
      let proof = await result2.account.generateProof(payload);
      expect(proof).to.be.an('object').that.has.property('data');
    }).timeout(15000);

    it('generateProof() returns error for unknown value for payload.type', async () => {
      ShieldedWallet.fs.readFile.withArgs(keyFile2).resolves(Buffer.from(JSON.stringify(encryptedAccount2)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile2).resolves(Buffer.from(password2));
      let result2 = await wallet.loadAccount(keyFile2);
      expect(result2.account.address).to.deep.equal(testAccount2.address);
      expect(testAccount2._x.eq(result2.account._x)).to.be.true;
      var payload = {};
      payload.type = 'lol';
      payload.args = { dummy: 'lol' };
      await expect(result2.account.generateProof(payload)).to.be.rejectedWith(`Unknown value of proof type`);
    });

    it('generateProof() returns error for no value for payload.type', async () => {
      ShieldedWallet.fs.readFile.withArgs(keyFile2).resolves(Buffer.from(JSON.stringify(encryptedAccount2)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile2).resolves(Buffer.from(password2));
      let result2 = await wallet.loadAccount(keyFile2);
      expect(result2.account.address).to.deep.equal(testAccount2.address);
      expect(testAccount2._x.eq(result2.account._x)).to.be.true;
      var payload = {};
      await expect(result2.account.generateProof(payload)).to.be.rejectedWith(`Payload value for proof type cant be null`);
    });

    it('generateProof() returns error for no value for payload.args', async () => {
      ShieldedWallet.fs.readFile.withArgs(keyFile2).resolves(Buffer.from(JSON.stringify(encryptedAccount2)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile2).resolves(Buffer.from(password2));
      let result2 = await wallet.loadAccount(keyFile2);
      expect(result2.account.address).to.deep.equal(testAccount2.address);
      expect(testAccount2._x.eq(result2.account._x)).to.be.true;
      var payload = {};
      payload.type = ZKP_PROOF_TYPE.TRANSFER_PROOF;
      await expect(result2.account.generateProof(payload)).to.be.rejectedWith(`Payload value for proof args cant be null`);
    });

    it('generateProof() returns error for failure during transfer proof generation', async () => {
      ShieldedWallet.fs.readFile.withArgs(keyFile2).resolves(Buffer.from(JSON.stringify(encryptedAccount2)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile2).resolves(Buffer.from(password2));
      let result2 = await wallet.loadAccount(keyFile2);
      expect(result2.account.address).to.deep.equal(testAccount2.address);
      expect(testAccount2._x.eq(result2.account._x)).to.be.true;
      var payload = {};
      payload.type = ZKP_PROOF_TYPE.TRANSFER_PROOF;
      payload.args = { dummy: 'lol' };
      await expect(result2.account.generateProof(payload)).to.be.rejectedWith(new RegExp(`Error while generating transfer proof:.*`));
    });

    it('generateProof() returns error for failure during burn proof generation', async () => {
      ShieldedWallet.fs.readFile.withArgs(keyFile2).resolves(Buffer.from(JSON.stringify(encryptedAccount2)));
      ShieldedWallet.fs.readFile.withArgs(passwordFile2).resolves(Buffer.from(password2));
      let result2 = await wallet.loadAccount(keyFile2);
      expect(result2.account.address).to.deep.equal(testAccount2.address);
      expect(testAccount2._x.eq(result2.account._x)).to.be.true;
      var payload = {};
      payload.type = ZKP_PROOF_TYPE.BURN_PROOF;
      payload.args = { dummy: 'lol' };
      await expect(result2.account.generateProof(payload)).to.be.rejectedWith(new RegExp(`Error while generating burn proof:.*`));
    });
  });

  describe('createAccount()', () => {
    let mappingFile;
    before(() => {
      mappingFile = join(wallet.dataDir, ETH_SHIELD_ACCOUNT_MAPPING);
    });

    it('createAccount() successfully', async () => {
      ShieldedWallet.fs.readFile.withArgs(mappingFile).rejects();
      ShieldedWallet.fs.existsSync.withArgs(mappingFile).returns(false);

      const newAccount = await wallet.createAccount('0x28AAf3AAe78275FC0958669f643C13C75Eb3b847');
      expect(ShieldedWallet.fs.writeFile).calledWith(mappingFile, JSON.stringify([{ ethAccount: '0x28AAf3AAe78275FC0958669f643C13C75Eb3b847', shieldedAccount: newAccount.shieldedAccount }]));
    });

    it('createAccount() throws if content is not valid JSON', async () => {
      ShieldedWallet.fs.readFile.withArgs(mappingFile).resolves(Buffer.from('bad content'));
      ShieldedWallet.fs.existsSync.withArgs(mappingFile).returns(true);

      await expect(wallet.createAccount('0x28AAf3AAe78275FC0958669f643C13C75Eb3b847')).to.be.rejectedWith('Failed while reading or writing to local eth-shield mappings file');
    });

    it('createAccount() throws if content is not valid JSON', async () => {
      ShieldedWallet.fs.readFile.withArgs(mappingFile).resolves(Buffer.from(JSON.stringify({})));
      ShieldedWallet.fs.writeFile.withArgs(mappingFile, sinon.match.string).rejects();

      await expect(wallet.createAccount('0x28AAf3AAe78275FC0958669f643C13C75Eb3b847')).to.be.rejectedWith('Failed while reading or writing to local eth-shield mappings file');
    });
  });

  describe('getAccounts()', () => {
    let mappingFile;

    before(() => {
      mappingFile = join(wallet.dataDir, ETH_SHIELD_ACCOUNT_MAPPING);
    });

    it('getAccounts() loads all local accounts from the mapping file', async () => {
      const mapping = [
        {
          ethAccount: '0x28AAf3AAe78275FC0958669f643C13C75Eb3b847',
          shieldedAccount: ['0x2cef8f6dda5caf7bfdc21a122d301d00c39a6366d5d05ebd83641a0605fef673', '0x2600c6dd47167eb7de99dbc0e74744490dbf784ba8c2e5dfbd619b39e3349b41'],
        },
      ];
      ShieldedWallet.fs.readFile.withArgs(mappingFile).resolves(Buffer.from(JSON.stringify(mapping)));

      let result = await wallet.getAccounts();
      expect(result).to.be.an('array');
      expect(result[0]).to.be.an('object').that.has.property('ethAccount');
      expect(result[0]).to.be.an('object').that.has.property('shieldedAccount');
      expect(result[0].ethAccount).to.equal('0x28AAf3AAe78275FC0958669f643C13C75Eb3b847');
      expect(result[0].shieldedAccount).to.deep.equal(mapping[0].shieldedAccount);
    });

    it('getAccounts() returns empty array if keystore is empty', async () => {
      ShieldedWallet.fs.readdir.resolves([]);

      let result = await wallet.getAccounts();
      expect(result).to.be.an('array').that.is.empty;
    });
  });
});
