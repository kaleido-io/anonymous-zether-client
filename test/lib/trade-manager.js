'use strict';

const chai = require('chai');
const sinon = require('sinon');
chai.use(require('sinon-chai'));
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const { join } = require('path');
const os = require('os');
const fs = require('fs-extra');
const nock = require('nock');
const BN = require('bn.js');

const { ElGamal } = require('@anonymous-zether/anonymous.js/src/utils/algebra.js');
const bn128 = require('@anonymous-zether/anonymous.js/src/utils/bn128');
const bn128Utils = require('@anonymous-zether/anonymous.js/src/utils/utils');
const { rpc, reset, fullSetup } = require('./test-utils.js');
const Prover = require('../../lib/keystore/shielded/prover.js');

const sleep = require('util').promisify(require('timers').setTimeout);

describe('trade-manager - end to end test', () => {
  let TradeManager, wm, shielded, tmpdir, tradeManager, Utils, epochLength;
  let alice, bob;

  before(async function () {
    this.timeout(5000);
    tmpdir = fullSetup('zether-trade-manager-test');
    epochLength = parseInt(process.env.ZSC_EPOCH_LENGTH);

    const { HDWallet } = require('../../lib/keystore/hdwallet');
    const ShieldedWallet = require('../../lib/keystore/shielded');
    const WalletManager = require('../../lib/wallet-manager');
    Utils = require('../../lib/utils.js');
    const testWallet = new HDWallet('test-hdwallet');
    await testWallet.init();
    wm = new WalletManager();
    await wm.init();
    wm.addWallet('test-hdwallet', testWallet);
    shielded = new ShieldedWallet();

    TradeManager = require('../../lib/trade-manager');
  });

  beforeEach(async () => {
    tradeManager = new TradeManager(wm, shielded);
    await tradeManager.init();
  });

  afterEach(async () => {
    tradeManager.cashTokenClient.web3.currentProvider.disconnect();
    tradeManager.zetherTokenClient.web3.currentProvider.disconnect();
    expect(nock.pendingMocks()).to.deep.equal([]);
    nock.cleanAll();
  });

  after(() => {
    fs.removeSync(tmpdir);
  });

  it('init() - success', async () => {
    expect(tradeManager.zetherTokenClient.hdwallet).to.not.be.undefined;
  });

  it('initBalanceCache() - success', async () => {
    await expect(tradeManager.zetherTokenClient.initBalanceCache()).to.not.throw;
  });

  it('create ethereum and shielded accounts for Alice', async () => {
    const ethAccount = await wm.newAccount('test-hdwallet');
    const shieldedAccount = await shielded.createAccount(ethAccount.address);
    alice = {
      ethAccount,
      shieldedAccount,
    };
  });

  it('create ethereum and shielded accounts for Bob', async () => {
    const ethAccount = await wm.newAccount('test-hdwallet');
    const shieldedAccount = await shielded.createAccount(ethAccount.address);
    bob = {
      ethAccount,
      shieldedAccount,
    };
  });

  it('register Alice', async () => {
    await tradeManager.zetherTokenClient.registerAccount(alice.ethAccount.address);
  });

  it('register Bob', async () => {
    await tradeManager.zetherTokenClient.registerAccount(bob.ethAccount.address);
  });

  it('mint some tokens to Alice', async () => {
    await tradeManager.cashTokenClient.mint(alice.ethAccount.address, 10000);
  });

  it('get balance of Alice in ERC20', async () => {
    const balance = await tradeManager.cashTokenClient.getERC20Balance(alice.ethAccount.address);
    expect(balance).to.equal('10000');
  });

  it('fundAccount() for Alice shielded account', async () => {
    await tradeManager.zetherTokenClient.fundAccount(alice.ethAccount.address, 100);
    expect(nock.isDone());
  });

  it('get balance of Alice in ERC20', async () => {
    const balance = await tradeManager.cashTokenClient.getERC20Balance(alice.ethAccount.address);
    expect(balance).to.equal('9900');
  });

  it('getBalance() for given ZSC and shielded account index', async function () {
    this.timeout(3 * epochLength * 1000);
    const wait = (Utils.timeBeforeNextEpoch() + 1) * 1000;
    await sleep(wait);
    const result = await tradeManager.zetherTokenClient.getBalance(alice.shieldedAccount);
    expect(result).to.equal(100);
  });

  it('withdraw() should withdraw from an shielded account with zsc', async function () {
    this.timeout(3 * epochLength * 1000);
    await sleep(epochLength * 1000);
    await tradeManager.zetherTokenClient.withdraw(alice.ethAccount.address, 10);
  });

  it('transfer() should transfer from an shielded account to another shielded with zsc and erc20 balance must be updated', async function () {
    this.timeout(3 * epochLength * 1000);
    await tradeManager.zetherTokenClient.transfer(alice.shieldedAccount, bob.shieldedAccount, 10);
  });

  it('transfer() with decoys', async function () {
    this.timeout(3 * epochLength * 1000);
    const decoy1_ethAccount = await wm.newAccount('test-hdwallet');
    const decoy1_shieldedAccount = await shielded.createAccount(decoy1_ethAccount.address);
    await tradeManager.zetherTokenClient.registerAccount(decoy1_ethAccount.address);
    const decoy2_ethAccount = await wm.newAccount('test-hdwallet');
    const decoy2_shieldedAccount = await shielded.createAccount(decoy2_ethAccount.address);
    await tradeManager.zetherTokenClient.registerAccount(decoy2_ethAccount.address);

    const decoys = [decoy1_shieldedAccount, decoy2_shieldedAccount];
    await tradeManager.zetherTokenClient.transfer(alice.shieldedAccount, bob.shieldedAccount, 10, decoys);
  });
});

describe('decrypt balances', () => {
  let TradeManager, tradeManager, tmpdir;

  before(async () => {
    tmpdir = join(os.tmpdir(), 'trade-manager-test');
    reset(() => {
      process.env.ETH_URL = 'ws://127.0.0.1:8545';
      process.env.DATA_DIR = tmpdir;
      process.env.ERC20_ADDRESS = '0x9101179e67001879277c11d420C7317dc5415bdA';
      process.env.ZSC_ADDRESS = '0x849Cf796E88E19F3f7603c82536eE73DF6140E89';
      process.env.ADMIN_SIGNER = '0x7950ee77d50fd245f663bded5a15f150baeb5982215bb3315239dd762c72bb34';
    });
    const ShieldedWallet = require('../../lib/keystore/shielded');
    const shielded = new ShieldedWallet();
    const WalletManager = require('../../lib/wallet-manager');
    const wm = new WalletManager();
    TradeManager = require('../../lib/trade-manager');
    tradeManager = new TradeManager(wm, shielded);
    await tradeManager.init();
  });

  after(() => {
    fs.removeSync(tmpdir);
    tradeManager.cashTokenClient.web3.currentProvider.disconnect();
    tradeManager.zetherTokenClient.web3.currentProvider.disconnect();
  });

  it('_decryptEncryptedBalance() - success', async () => {
    const testAccount = bn128Utils.createAccount();
    const testBalance = new BN(100, 10);
    const randomness = bn128.randomScalar();
    const cipher_left = ElGamal.base.g.mul(testBalance).add(testAccount.y.mul(randomness));
    const cipher_right = bn128.curve.g.mul(randomness);
    const prover = new Prover(testAccount.x, testAccount.y);
    const balance = await tradeManager.zetherTokenClient._decryptEncryptedBalance([bn128.serialize(cipher_left), bn128.serialize(cipher_right)], prover);
    expect(balance).to.equal(100);
  });
});

describe('error handling', () => {
  let TradeManager;

  describe('trade-manager constructor() handling missing configurations', () => {
    it('throws if no ethUrl was provided', () => {
      reset(() => {});
      const ShieldedWallet = require('../../lib/keystore/shielded');
      const shielded = new ShieldedWallet();
      const WalletManager = require('../../lib/wallet-manager');
      const wm = new WalletManager();
      TradeManager = require('../../lib/trade-manager');
      expect(() => new TradeManager(wm, shielded)).to.throw('Must provide the URL for the Ethereum JSON RPC endpoint');
    });

    it('throws if no erc20 address was provided', () => {
      reset(() => {
        process.env.ETH_URL = 'http://localhost:7545';
      });
      const ShieldedWallet = require('../../lib/keystore/shielded');
      const shielded = new ShieldedWallet();
      const WalletManager = require('../../lib/wallet-manager');
      const wm = new WalletManager();
      TradeManager = require('../../lib/trade-manager');
      expect(() => new TradeManager(wm, shielded)).to.throw('Must provide the address of the ERC20 contract');
    });

    it('throws if no ZSC address was provided', () => {
      reset(() => {
        process.env.ETH_URL = 'http://localhost:7545';
        process.env.ERC20_ADDRESS = '0x1cd89e376b23ac5e51b249aa9192003f1dd17941';
        process.env.ADMIN_SIGNER = '0x7950ee77d50fd245f663bded5a15f150baeb5982215bb3315239dd762c72bb34';
      });
      const ShieldedWallet = require('../../lib/keystore/shielded');
      const shielded = new ShieldedWallet();
      const WalletManager = require('../../lib/wallet-manager');
      const wm = new WalletManager();
      TradeManager = require('../../lib/trade-manager');
      expect(() => new TradeManager(wm, shielded)).to.throw('Must provide the address of the ZSC contract');
    });
  });

  describe('trade-manager methods error handling', () => {
    let tmpdir, TradeManager, tm, WalletManager, ShieldedWallet, ZetherTokenClient;

    before(() => {
      tmpdir = join(os.tmpdir(), 'trade-manager-test');
      reset(() => {
        process.env.ETH_URL = 'http://127.0.0.1:8545';
        process.env.DATA_DIR = tmpdir;
        process.env.ERC20_ADDRESS = '0x9101179e67001879277c11d420C7317dc5415bdA';
        process.env.ZSC_ADDRESS = '0x849Cf796E88E19F3f7603c82536eE73DF6140E89';
        process.env.ADMIN_SIGNER = '0x7950ee77d50fd245f663bded5a15f150baeb5982215bb3315239dd762c72bb34';
      });
      ShieldedWallet = require('../../lib/keystore/shielded');
      WalletManager = require('../../lib/wallet-manager');
      ZetherTokenClient = require('../../lib/trade-manager/zether-token.js');
      sinon.stub(ZetherTokenClient.timers, 'sleep').resolves();
      TradeManager = require('../../lib/trade-manager');
    });

    after(() => {
      fs.removeSync(tmpdir);
      ZetherTokenClient.timers.sleep.restore();
    });

    beforeEach(() => {
      const wm = new WalletManager();
      const shielded = new ShieldedWallet();
      tm = new TradeManager(wm, shielded);
      sinon.stub(tm.zetherTokenClient.shieldedWallet, 'loadAccountByPublicKey');
    });

    afterEach(() => {
      tm.cashTokenClient.web3.currentProvider && tm.cashTokenClient.web3.currentProvider.disconnect();
      tm.zetherTokenClient.web3.currentProvider && tm.zetherTokenClient.web3.currentProvider.disconnect();
    });

    describe('approve() error handling', () => {
      it('handle transaction failure', async () => {
        tm.web3 = {
          eth: {
            getTransactionCount: () => {
              return Promise.reject(new Error('Bang!'));
            },
          },
        };
        await expect(tm.cashTokenClient.approve('0x1', '0x2', 100)).to.eventually.be.rejectedWith('Failed to approve the ZSC contract as spender for the account 0x1');
      });
    });

    describe('fundAccount() error handling', () => {
      it('can not locate shielded account', async () => {
        sinon.stub(tm.zetherTokenClient.shieldedWallet, 'findShieldedAccount').resolves(undefined);
        await expect(tm.zetherTokenClient.fundAccount('0x1', 100)).to.eventually.be.rejectedWith('ethAccount 0x1 does not have a shielded account');
      });

      it('failed to register shielded account', async () => {
        tm.zetherTokenClient.web3 = {
          eth: {
            getTransactionCount: () => Promise.reject(new Error('Bang!')),
          },
        };
        sinon.stub(tm.zetherTokenClient.shieldedWallet, 'findShieldedAccount').resolves(['0x11', '0x22']);
        sinon.stub(tm.cashTokenClient, 'approve').resolves();
        await expect(tm.zetherTokenClient.fundAccount('0x1', 100)).to.eventually.be.rejectedWith('Failed to fund shielded account 0x11,0x22 for amount 100');
      });
    });

    describe('getBalance() error handling', () => {
      it('getBalance() error handling - failed to get local shieldedAccount', async () => {
        tm.zetherTokenClient.shieldedWallet.loadAccountByPublicKey.resolves(undefined);

        const address = ['0x1c2a73714f5a2366f16436de9242dfc2587cf75c25175031c3d3266a8236b709', '0x086e14bab439a55ce39a92ca5eed7948937918c36717f0de2f10c5294bb5e11d'];
        await expect(tm.zetherTokenClient.getBalance(address)).to.eventually.be.rejectedWith(
          'Shielded account 0x1c2a73714f5a2366f16436de9242dfc2587cf75c25175031c3d3266a8236b709,0x086e14bab439a55ce39a92ca5eed7948937918c36717f0de2f10c5294bb5e11d does not exist in this service locally, can not be used to decrypt balances'
        );
      });

      it('getBalance() error handling - failed to call smart contract simulateAccounts()', async () => {
        const bytes = Buffer.from('1234', 'hex');
        const address = { x: bytes, y: bytes, getX: () => bytes, getY: () => bytes };
        tm.zetherTokenClient.shieldedWallet.loadAccountByPublicKey.resolves({ account: { address } });
        nock('http://127.0.0.1:8545')
          .post('/', (body) => {
            return body.method === 'net_version';
          })
          .reply(201, () =>
            rpc({
              result: '0x501c',
            })
          );

        nock('http://127.0.0.1:8545')
          .post('/', (body) => {
            return body.method === 'eth_call';
          })
          .reply(201, () =>
            rpc({
              error: 'dummy',
            })
          );

        await expect(tm.zetherTokenClient.getBalance('1')).to.eventually.be.rejectedWith('Failed to call simulateAccounts()');
      });
    });

    describe('withdraw() error handling', () => {
      beforeEach(() => {
        sinon.stub(tm.zetherTokenClient.shieldedWallet, 'findShieldedAccount');
      });

      it('withdraw() error handling - can not locate local shielded account', async () => {
        await expect(tm.zetherTokenClient.withdraw('0x1', 100)).to.eventually.be.rejectedWith('Shielded account not found for ethereum account 0x1');
      });

      it('withdraw() error handling - failed to call simulateAccounts()', async () => {
        const targetAccount = ['0x2f4176ab9fe2dce4517ab675f994335ed76eccf1461e2d90563cf477877bcb8d', '0x2fee819eb34f853582ef8398105d7e2fbfd962cbba11fd03d67b56e2dfeb1c93'];
        tm.zetherTokenClient.shieldedWallet.findShieldedAccount.resolves(targetAccount);
        const bytes = Buffer.from('1234', 'hex');
        const address = { x: bytes, y: bytes, getX: () => bytes, getY: () => bytes };
        tm.zetherTokenClient.shieldedWallet.loadAccountByPublicKey.resolves({ account: { address } });
        sinon.stub(tm.zetherTokenClient, '_checkBalance').rejects(new Error('Bang!'));

        await expect(tm.zetherTokenClient.withdraw('0xb60e8dd61c5d32be8058bb8eb970870f07233155', 100)).to.eventually.be.rejectedWith(
          `Failed to check balance for shielded account ${targetAccount} with ZSC`
        );
      });

      it('withdraw() error handling - insufficient funds', async () => {
        const targetAccount = ['0x2f4176ab9fe2dce4517ab675f994335ed76eccf1461e2d90563cf477877bcb8d', '0x2fee819eb34f853582ef8398105d7e2fbfd962cbba11fd03d67b56e2dfeb1c93'];
        tm.zetherTokenClient.shieldedWallet.findShieldedAccount.resolves(targetAccount);
        const bytes = Buffer.from('1234', 'hex');
        const address = { x: bytes, y: bytes, getX: () => bytes, getY: () => bytes };
        tm.zetherTokenClient.shieldedWallet.loadAccountByPublicKey.resolves({ account: { address } });
        sinon.stub(tm.zetherTokenClient, '_simulateAccounts').resolves(['0x1']);
        sinon.stub(tm.zetherTokenClient, '_decryptEncryptedBalance').resolves(50);
        await expect(tm.zetherTokenClient.withdraw('0xb60e8dd61c5d32be8058bb8eb970870f07233155', 100)).to.eventually.be.rejectedWith('Amount to withdraw must be less than or equal to shielded funds');
      });

      it('withdraw() error handling - failed to call smart contract withdraw()', async () => {
        const targetAccount = ['0x2f4176ab9fe2dce4517ab675f994335ed76eccf1461e2d90563cf477877bcb8d', '0x2fee819eb34f853582ef8398105d7e2fbfd962cbba11fd03d67b56e2dfeb1c93'];
        tm.zetherTokenClient.shieldedWallet.findShieldedAccount.resolves(targetAccount);
        const bytes = Buffer.from('1234', 'hex');
        const address = { x: bytes, y: bytes, getX: () => bytes, getY: () => bytes };
        tm.zetherTokenClient.shieldedWallet.loadAccountByPublicKey.resolves({ account: { address, generateProof: () => ({ proof: '0x1', u: '0x2' }) } });
        sinon.stub(tm.zetherTokenClient, 'sendTransaction').rejects(new Error('Bang!'));
        sinon.stub(tm.zetherTokenClient, '_checkBalance').resolves({ balance: 150, shieldedAccountStates: [] });
        await expect(tm.zetherTokenClient.withdraw('0xb60e8dd61c5d32be8058bb8eb970870f07233155', 100)).to.eventually.be.rejectedWith('Failed to complete withdrawal of shielded tokens');
      });
    });
  });
});
