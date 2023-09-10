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
const AbiCoder = require('web3-eth-abi');
const BN = require('bn.js');

const bn128 = require('@anonymous-zether/anonymous.js/src/utils/bn128.js');
const rpc = require('./mock-rpc.js');
const constants = require('../../lib/constants.js');

function reset(setup) {
  delete require.cache[require.resolve('../../lib/keystore/hdwallet')];
  delete require.cache[require.resolve('../../lib/keystore/shielded')];
  delete require.cache[require.resolve('../../lib/trade-manager.js')];
  delete require.cache[require.resolve('../../lib/wallet-manager.js')];
  delete require.cache[require.resolve('../../lib/utils.js')];
  delete require.cache[require.resolve('../../lib/config.js')];
  setup();
}

describe('trade-manager.js constructor() handling missing configurations', () => {
  let TradeManager;

  it('throws if no ethUrl was provided', () => {
    reset(() => {});
    TradeManager = require('../../lib/trade-manager');
    expect(() => new TradeManager()).to.throw('Must provide the URL for the Ethereum JSON RPC endpoint');
  });

  it('throws if no erc20 address was provided', () => {
    reset(() => {
      process.env.ETH_URL = 'http://localhost:7545';
    });
    TradeManager = require('../../lib/trade-manager');
    expect(() => new TradeManager()).to.throw('Must provide the address of the ERC20 contract');
  });

  it('throws if no ethUrl was provided', () => {
    reset(() => {
      process.env.ETH_URL = 'http://localhost:7545';
      process.env.ERC20_ADDRESS = '0x1cd89e376b23ac5e51b249aa9192003f1dd17941';
    });
    TradeManager = require('../../lib/trade-manager');
    expect(() => new TradeManager()).to.throw('Must provide the address of the ZSC contract');
  });
});

describe('trade-manager.js', () => {
  let TradeManager, wm, shielded, tmpdir, tradeManager, Utils;
  let alice, bob;

  before(async function () {
    this.timeout(5000);
    tmpdir = join(os.tmpdir(), 'trade-manager-test');
    reset(() => {
      process.env.ERC20_ADDRESS = '0x474cb0d27e4593738d250c9755265D5c8290C08D';
      process.env.ZSC_ADDRESS = '0xC34dD8eA9f74E4De3fd1C0C3671c81CcB60A4CCd';
      process.env.CHAIN_ID = '1337';
      process.env.ADMIN_SIGNER = '0x7950ee77d50fd245f663bded5a15f150baeb5982215bb3315239dd762c72bb34';
      process.env.ETH_URL = 'ws://localhost:7545';
      process.env.DATA_DIR = tmpdir;
    });

    const { HDWallet } = require('../../lib/keystore/hdwallet');
    const ShieldedAccount = require('../../lib/keystore/shielded');
    const WalletManager = require('../../lib/wallet-manager.js');
    Utils = require('../../lib/utils.js');
    const testWallet = new HDWallet('test-hdwallet');
    await testWallet.init();
    wm = new WalletManager();
    await wm.init();
    wm.addWallet('test-hdwallet', testWallet);
    shielded = new ShieldedAccount();

    TradeManager = require('../../lib/trade-manager.js');
    sinon.stub(TradeManager.timers, 'sleep').resolves();
  });

  beforeEach(async () => {
    tradeManager = new TradeManager();
    await tradeManager.init();
  });

  afterEach(() => {
    expect(nock.pendingMocks()).to.deep.equal([]);
    nock.cleanAll();
  });

  after(() => {
    fs.removeSync(tmpdir);
  });

  describe('init()', () => {
    it('success', async () => {
      expect(tradeManager.hdwallet).to.not.be.undefined;
    });
  });

  describe('initBalanceCache()', () => {
    it('success', async () => {
      await expect(tradeManager.initBalanceCache()).to.not.throw;
    });
  });

  describe('set up shielded accounts', () => {
    it('create ethereum and shielded accounts for Alice', async () => {
      const ethAccount = await wm.newAccount('test-hdwallet');
      const shieldedAccount = await shielded.createAccount(ethAccount);
      alice = {
        ethAccount,
        shieldedAccount,
      };
    });

    it('create ethereum and shielded accounts for Bob', async () => {
      const ethAccount = await wm.newAccount('test-hdwallet');
      const shieldedAccount = await shielded.createAccount(ethAccount);
      bob = {
        ethAccount,
        shieldedAccount,
      };
    });
  });

  describe('fundAccount()', () => {
    it('fundAccount() for given ethAccount', async () => {
      // let host = 'http://localhost:7545';
      // let path = '/';

      // nock(host)
      //   .post('/', (body) => {
      //     return body.method === 'net_version';
      //   })
      //   .times(2)
      //   .reply(201, () =>
      //     rpc({
      //       result: '0x501c',
      //     })
      //   );

      // nock(host)
      //   .post(path, (body) => {
      //     return body.method === 'eth_sendTransaction';
      //   })
      //   .times(2)
      //   .reply(201, () =>
      //     rpc({
      //       result: '0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331',
      //     })
      //   );

      // nock(host)
      //   .post(path, (body) => {
      //     return body.method === 'eth_getTransactionCount';
      //   })
      //   .times(2)
      //   .reply(201, () =>
      //     rpc({
      //       result: '0x1',
      //     })
      //   );

      // nock(host)
      //   .post(path, (body) => {
      //     return body.method === 'eth_getTransactionReceipt';
      //   })
      //   .times(2)
      //   .reply(201, () =>
      //     rpc({
      //       result: {
      //         transactionHash: '0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331',
      //         transactionIndex: '0x1', // 1
      //         blockNumber: '0xb', // 11
      //         blockHash: '0xc6ef2fc5426d6ad6fd9e2a26abeab0aa2411b7ab17f30a99d3cb96aed1d1055b',
      //         cumulativeGasUsed: '0x33bc', // 13244
      //         gasUsed: '0x4dc', // 1244
      //         contractAddress: '0xb60e8dd61c5d32be8058bb8eb970870f07233155', // or null, if none was created
      //         logs: [],
      //         logsBloom: '0x0000', // 256 byte bloom filter
      //         status: '0x1',
      //       },
      //     })
      //   );

      await tradeManager.fundAccount(alice.ethAccount.address, 1000);

      expect(nock.isDone());
    });

    it('fundAccount() error handling - can not locate ZSC contract', async () => {
      let tm = new TradeManager();

      await expect(tm.fundAccount('0x1', '0x2', 100)).to.eventually.be.rejectedWith('Invalid zether smart contract address: 0x1');
    });

    it('fundAccount() error handling - can not locate shielded account', async () => {
      let tm = new TradeManager();
      sinon.stub(tm, 'findShieldedAccount').resolves(undefined);

      await expect(tm.fundAccount('0x1', '0x2', 100)).to.eventually.be.rejectedWith('ethAccount 0x2 does not have a shielded account');
    });

    it('fundAccount() error handling - failed to register shielded account', async () => {
      let tm = new TradeManager();
      tm.init({
        sendTransaction: () => Promise.reject(new Error('Bang!')),
      });
      sinon.stub(tm, 'findShieldedAccount').resolves({ ethAccount: '0x1', shieldedAccount: ['0x11', '0x22'] });
      sinon.stub(tm, 'approveZSC').resolves();

      await expect(tm.fundAccount('0x1', '0x2', 100)).to.eventually.be.rejectedWith('Failed to fund shielded account {"ethAccount":"0x1","shieldedAccount":["0x11","0x22"]} for amount 100');
    });
  });

  describe('getBalance()', () => {
    it('getBalance() for given ZSC and shielded account index', async () => {
      sinon.stub(tradeManager, '_recoverBalance').resolves(1000);
      TradeManager.fs.readFile.withArgs(join(tmpDir, constants.ETH_SHIELD_ACCOUNT_MAPPING)).resolves(
        Buffer.from(
          JSON.stringify([
            {
              ethAccount: '0xa0154fBFf939E6ea17596FE9b1103ad5B2dFf366',
              shieldedAccount: ['0x1d744c01c09ac43b4e72383da3d0266a154dde45235163231c6e06dc3d48296d', '0x15eae5218d0339e0081b82a181fd1eb6e74b2669003c05794d9d536101431cd3'],
            },
            {
              ethAccount: '0xFB170f365E12d49403A958067F8652f4598D6e71',
              shieldedAccount: ['0x2f4176ab9fe2dce4517ab675f994335ed76eccf1461e2d90563cf477877bcb8d', '0x2fee819eb34f853582ef8398105d7e2fbfd962cbba11fd03d67b56e2dfeb1c93'],
            },
          ])
        )
      );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED),
          })
        );

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      let result = await tradeManager.getBalance(zsc, '1');

      expect(result).to.equal(1000);
    });

    it('getBalance() error handling - failed to get local shieldedAccount', async () => {
      sinon.stub(tradeManager, 'findShieldedAccount').resolves(undefined);

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await expect(tradeManager.getBalance(zsc, '1')).to.eventually.be.rejectedWith('Shielded account index 1 can not be located');
    });

    it('getBalance() error handling - failed to match with local shieldedAccount', async () => {
      sinon.stub(tradeManager, 'findShieldedAccount').resolves({ shieldedAccount: ['0x11', '0x22'] });

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await expect(tradeManager.getBalance(zsc, '1')).to.eventually.be.rejectedWith('Shielded account 0x11,0x22 does not exist in this service locally, can not be used to decrypt balances');
    });

    it('getBalance() error handling - failed to call smart contract simulateAccounts()', async () => {
      let account = ['0x2f4176ab9fe2dce4517ab675f994335ed76eccf1461e2d90563cf477877bcb8d', '0x2fee819eb34f853582ef8398105d7e2fbfd962cbba11fd03d67b56e2dfeb1c93'];
      sinon.stub(tradeManager, 'findShieldedAccount').resolves({ shieldedAccount: account });
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            error: 'dummy',
          })
        );

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await expect(tradeManager.getBalance(zsc, '1')).to.eventually.be.rejectedWith('Failed to call simulateAccounts()');
    });
  });

  describe('withdraw()', () => {
    it('withdraw() should withdraw from an shielded account with zsc', async () => {
      sinon.stub(tradeManager, '_recoverBalance').resolves(1000);

      TradeManager.fs.readFile.withArgs(join(tmpDir, constants.ETH_SHIELD_ACCOUNT_MAPPING)).resolves(Buffer.from(JSON.stringify(MOCK_ETH_SHIELD_ACCOUNT_MAPPING)));
      let host = 'http://dummy.io';
      let path = '/';

      nock(host)
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .times(2)
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock(host)
        .post(path, (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED),
          })
        );

      nock(host)
        .post(path, (body) => {
          return body.method === 'eth_sendTransaction';
        })
        .times(1)
        .reply(201, () =>
          rpc({
            result: '0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331',
          })
        );

      nock(host)
        .post(path, (body) => {
          return body.method === 'eth_getTransactionReceipt';
        })
        .times(1)
        .reply(201, () =>
          rpc({
            result: {
              transactionHash: '0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331',
              transactionIndex: '0x1', // 1
              blockNumber: '0xb', // 11
              blockHash: '0xc6ef2fc5426d6ad6fd9e2a26abeab0aa2411b7ab17f30a99d3cb96aed1d1055b',
              cumulativeGasUsed: '0x33bc', // 13244
              gasUsed: '0x4dc', // 1244
              contractAddress: '0xb60e8dd61c5d32be8058bb8eb970870f07233155', // or null, if none was created
              logs: [],
              logsBloom: '0x0000', // 256 byte bloom filter
              status: '0x1',
            },
          })
        );

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await tradeManager.withdraw(zsc, MOCK_ETH_SHIELD_ACCOUNT_MAPPING[0].ethAccount, MOCK_ETH_SHIELD_ACCOUNT_MAPPING[0].shieldedAccount, 100);
    }).timeout(constants.ZSC_EPOCH_LENGTH * 1000);

    it('withdraw() error handling - can not locate ZSC contract', async () => {
      let tm = new TradeManager();

      await expect(tm.withdraw('0x1', '0x2', ['0x11', '0x22'], 100)).to.eventually.be.rejectedWith('Invalid zether smart contract address: 0x1');
    });

    it('withdraw() error handling - can not locate local shielded account', async () => {
      await expect(tradeManager.withdraw('0x1', '0x2', ['0x11', '0x22'], 100)).to.eventually.be.rejectedWith(
        'Shielded account 0x11,0x22 does not exist in this service locally, can not be used to withdraw funds'
      );
    });

    it('withdraw() error handling - failed to call simulateAccounts()', async () => {
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            error: 'dummy',
          })
        );

      let targetAccount = ['0x2f4176ab9fe2dce4517ab675f994335ed76eccf1461e2d90563cf477877bcb8d', '0x2fee819eb34f853582ef8398105d7e2fbfd962cbba11fd03d67b56e2dfeb1c93'];
      await expect(tradeManager.withdraw('0xb60e8dd61c5d32be8058bb8eb970870f07233155', '0xa0154fBFf939E6ea17596FE9b1103ad5B2dFf366', targetAccount, 100)).to.eventually.be.rejectedWith(
        'Failed to call simulateAccounts()'
      );
    });

    it('withdraw() error handling - insufficient funds', async () => {
      sinon.stub(tradeManager, '_decryptEncryptedBalance').resolves(50);
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED),
          })
        );

      let targetAccount = ['0x2f4176ab9fe2dce4517ab675f994335ed76eccf1461e2d90563cf477877bcb8d', '0x2fee819eb34f853582ef8398105d7e2fbfd962cbba11fd03d67b56e2dfeb1c93'];
      await expect(tradeManager.withdraw('0xb60e8dd61c5d32be8058bb8eb970870f07233155', '0xa0154fBFf939E6ea17596FE9b1103ad5B2dFf366', targetAccount, 100)).to.eventually.be.rejectedWith(
        'Amount to withdraw must be less than or equal to shielded funds'
      );
    });

    it('withdraw() error handling - failed to call smart contract withdraw()', async () => {
      sinon.stub(tradeManager.walletManager, 'sendTransaction').rejects(new Error('Bang!'));
      sinon.stub(tradeManager, '_decryptEncryptedBalance').resolves(150);
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .times(2)
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED),
          })
        );

      let targetAccount = ['0x2f4176ab9fe2dce4517ab675f994335ed76eccf1461e2d90563cf477877bcb8d', '0x2fee819eb34f853582ef8398105d7e2fbfd962cbba11fd03d67b56e2dfeb1c93'];
      await expect(tradeManager.withdraw('0xb60e8dd61c5d32be8058bb8eb970870f07233155', '0xa0154fBFf939E6ea17596FE9b1103ad5B2dFf366', targetAccount, 100)).to.eventually.be.rejectedWith(
        'Failed to complete withdrawal of shielded tokens'
      );
    });
  });

  describe('transfer()', () => {
    it('transfer() should transfer from an shielded account to another shielded with zsc and erc20 balance must be updated', async () => {
      sinon.stub(tradeManager, '_recoverBalance').resolves(1000);
      sinon.stub(Utils, 'shuffleAccountsWParityCheck').returns({ y: SIMULATED[0], index: [1, 0] });
      TradeManager.fs.readFile.withArgs(join(tmpDir, constants.ETH_SHIELD_ACCOUNT_MAPPING)).resolves(Buffer.from(JSON.stringify(ACCOUNTS)));
      let host = 'http://dummy.io';
      let path = '/';

      // call to simulate accounts
      nock(host)
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .times(2)
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock(host)
        .post(path, (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED.concat(SIMULATED)),
          })
        );

      nock(host)
        .post(path, (body) => {
          return body.method === 'eth_getTransactionCount';
        })
        .times(1)
        .reply(201, () =>
          rpc({
            result: '0x0',
          })
        );

      nock(host)
        .post(path, (body) => {
          return body.method === 'eth_sendRawTransaction';
        })
        .times(1)
        .reply(201, () =>
          rpc({
            result: '0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331',
          })
        );

      nock(host)
        .post(path, (body) => {
          return body.method === 'eth_getTransactionReceipt';
        })
        .times(1)
        .reply(201, () =>
          rpc({
            result: {
              transactionHash: '0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331',
              transactionIndex: '0x1', // 1
              blockNumber: '0xb', // 11
              blockHash: '0xc6ef2fc5426d6ad6fd9e2a26abeab0aa2411b7ab17f30a99d3cb96aed1d1055b',
              cumulativeGasUsed: '0x33bc', // 13244
              gasUsed: '0x4dc', // 1244
              contractAddress: '0xb60e8dd61c5d32be8058bb8eb970870f07233155', // or null, if none was created
              logs: [],
              logsBloom: '0x0000', // 256 byte bloom filter
              status: '0x1',
            },
          })
        );

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await tradeManager.transfer(zsc, ACCOUNTS[1].shieldedAccount, ACCOUNTS[0].shieldedAccount, 100);

      Utils.shuffleAccountsWParityCheck.restore();
    }).timeout(2 * constants.ZSC_EPOCH_LENGTH * 1000);

    it('transfer() with decoys', async () => {
      sinon.stub(tradeManager, '_recoverBalance').resolves(1000);
      sinon.stub(Utils, 'shuffleAccountsWParityCheck').returns({ y: SIMULATED[0], index: [1, 0] });
      TradeManager.fs.readFile.withArgs(join(tmpDir, constants.ETH_SHIELD_ACCOUNT_MAPPING)).resolves(Buffer.from(JSON.stringify(ACCOUNTS)));
      let host = 'http://dummy.io';
      let path = '/';

      nock(host)
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .times(2)
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock(host)
        .post(path, (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED.concat(SIMULATED)),
          })
        );

      nock(host)
        .post(path, (body) => {
          return body.method === 'eth_getTransactionCount';
        })
        .times(1)
        .reply(201, () =>
          rpc({
            result: '0x0',
          })
        );

      nock(host)
        .post(path, (body) => {
          return body.method === 'eth_sendRawTransaction';
        })
        .times(1)
        .reply(201, () =>
          rpc({
            result: '0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331',
          })
        );

      nock(host)
        .post(path, (body) => {
          return body.method === 'eth_getTransactionReceipt';
        })
        .times(1)
        .reply(201, () =>
          rpc({
            result: {
              transactionHash: '0xe670ec64341771606e55d6b4ca35a1a6b75ee3d5145a99d05921026d1527331',
              transactionIndex: '0x1', // 1
              blockNumber: '0xb', // 11
              blockHash: '0xc6ef2fc5426d6ad6fd9e2a26abeab0aa2411b7ab17f30a99d3cb96aed1d1055b',
              cumulativeGasUsed: '0x33bc', // 13244
              gasUsed: '0x4dc', // 1244
              contractAddress: '0xb60e8dd61c5d32be8058bb8eb970870f07233155', // or null, if none was created
              logs: [],
              logsBloom: '0x0000', // 256 byte bloom filter
              status: '0x1',
            },
          })
        );

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      let decoys = [ACCOUNTS[1].shieldedAccount, ACCOUNTS[0].shieldedAccount];
      await tradeManager.transfer(zsc, ACCOUNTS[1].shieldedAccount, ACCOUNTS[0].shieldedAccount, 100, decoys);

      Utils.shuffleAccountsWParityCheck.restore();
    }).timeout(2 * constants.ZSC_EPOCH_LENGTH * 1000);

    it('transfer() error handling - failed to shuffle', async () => {
      sinon.stub(Utils, 'shuffleAccountsWParityCheck').throws(new Error('Bang!'));

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await expect(tradeManager.transfer(zsc, ACCOUNTS[1].shieldedAccount, ACCOUNTS[0].shieldedAccount, 100)).to.eventually.be.rejectedWith('Error while shuffling accounts array');

      Utils.shuffleAccountsWParityCheck.restore();
    });

    it('transfer() error handling - wait and failed to findZSCAddress', async () => {
      sinon.stub(Utils, 'timeBeforeNextEpoch').returns(5);
      sinon.stub(Utils, 'estimatedTimeForTxCompletion').returns(140000); // simulate a wait

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await expect(tradeManager.transfer(zsc, ACCOUNTS[1].shieldedAccount, ACCOUNTS[0].shieldedAccount, 100)).to.eventually.be.rejectedWith(`Invalid zether smart contract address: ${zsc}`);

      Utils.shuffleAccountsWParityCheck.restore();
      Utils.timeBeforeNextEpoch.restore();
      Utils.estimatedTimeForTxCompletion.restore();
    });

    it('transfer() error handling - failed to call simulateAccounts()', async () => {
      sinon.stub(Utils, 'shuffleAccountsWParityCheck').returns({ y: SIMULATED[0], index: [1, 0] });
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            error: 'dummy',
          })
        );

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await expect(tradeManager.transfer(zsc, ACCOUNTS[1].shieldedAccount, ACCOUNTS[0].shieldedAccount, 100)).to.eventually.be.rejectedWith(`Failed to call simulateAccounts()`);

      Utils.shuffleAccountsWParityCheck.restore();
    });

    it('transfer() error handling - failed to find sender account locally', async () => {
      sinon.stub(Utils, 'shuffleAccountsWParityCheck').returns({ y: SIMULATED[0], index: [1, 0] });
      sinon.stub(tradeManager, '_decryptEncryptedBalance').resolves(150);
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED),
          })
        );

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await expect(tradeManager.transfer(zsc, ['0x11', '0x22'], ACCOUNTS[0].shieldedAccount, 100)).to.eventually.be.rejectedWith(
        `Shielded account 0x11,0x22 does not exist in this service locally, can not be used to transfer funds`
      );

      Utils.shuffleAccountsWParityCheck.restore();
    });

    it('transfer() error handling - insufficient fund in sender account', async () => {
      sinon.stub(Utils, 'shuffleAccountsWParityCheck').returns({ y: SIMULATED[0], index: [1, 0] });
      sinon.stub(tradeManager, '_decryptEncryptedBalance').resolves(50);
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED),
          })
        );

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await expect(tradeManager.transfer(zsc, ACCOUNTS[1].shieldedAccount, ACCOUNTS[0].shieldedAccount, 100)).to.eventually.be.rejectedWith(`Insufficient balance in sender's shielded account`);

      Utils.shuffleAccountsWParityCheck.restore();
    });

    it('transfer() error handling - failed to call smart contract transfer()', async () => {
      sinon.stub(Utils, 'shuffleAccountsWParityCheck').returns({ y: SIMULATED[0], index: [1, 0] });
      sinon.stub(tradeManager, '_decryptEncryptedBalance').resolves(150);
      sinon.stub(tradeManager, 'signWithThrowAwayAccount').rejects(new Error('Bang!'));
      sinon.stub();
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .times(2)
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .times(2)
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED),
          })
        );

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await expect(tradeManager.transfer(zsc, ACCOUNTS[1].shieldedAccount, ACCOUNTS[0].shieldedAccount, 100)).to.eventually.be.rejectedWith(`Failed to complete shielded transfer`);

      Utils.shuffleAccountsWParityCheck.restore();
    });

    it('transfer() error handling - missing chain_id in pod', async () => {
      delete process.env.CHAIN_ID;
      sinon.stub(Utils, 'shuffleAccountsWParityCheck').returns({ y: SIMULATED[0], index: [1, 0] });
      sinon.stub(tradeManager, '_decryptEncryptedBalance').resolves(500);
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .times(2)
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .times(2)
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED),
          })
        );

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await expect(tradeManager.transfer(zsc, ACCOUNTS[1].shieldedAccount, ACCOUNTS[0].shieldedAccount, 100)).to.eventually.be.rejectedWith(sinon.match(/Unable to sign transaction with address.*/));

      Utils.shuffleAccountsWParityCheck.restore();
    });

    // mocks need fixing
    it('transfer() error handling - error sending signed transaction', async () => {
      sinon.stub(Utils, 'shuffleAccountsWParityCheck').returns({ y: SIMULATED[0], index: [1, 0] });
      sinon.stub(tradeManager, '_decryptEncryptedBalance').resolves(500);
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .times(3)
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED),
          })
        );
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_getTransactionCount';
        })
        .reply(201, () =>
          rpc({
            result: '0x0',
          })
        );
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_sendRawTransaction';
        })
        .reply(201, () =>
          rpc({
            error: {
              code: -32015,
              message: 'EVM says no',
            },
          })
        );
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            result: 'EVM reverted',
          })
        );

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await expect(tradeManager.transfer(zsc, ACCOUNTS[1].shieldedAccount, ACCOUNTS[0].shieldedAccount, 100)).to.eventually.be.rejectedWith(
        sinon.match(/Error while deploying contract or sending transaction.*/)
      );

      Utils.shuffleAccountsWParityCheck.restore();
    });
  });

  describe('approveZSC()', () => {
    it('approveZSC() error handling', async () => {
      let tm = new TradeManager({
        sendTransaction: () => {
          return Promise.reject(new Error('Bang!'));
        },
      });
      await expect(tm.approveZSC('0x1', '0x2', 100, {})).to.eventually.be.rejectedWith('Failed to approve 0x1 as spender for the account 0x2');
    });
  });

  describe('findShieldedAccount()', () => {
    it('findShieldedAccount() error handling', async () => {
      TradeManager.fs.readFile.rejects(new Error('File not found'));

      let account = await tradeManager.findShieldedAccount('0x1');
      expect(account).to.equal(undefined);
    });
  });

  describe('simulated crypto errors', () => {
    before(() => {
      ShieldedLocalWallet.prototype.getAccounts.resolves([
        {
          type: 'shielded-local',
          account: {
            address: ['0x2f4176ab9fe2dce4517ab675f994335ed76eccf1461e2d90563cf477877bcb8d', '0x2fee819eb34f853582ef8398105d7e2fbfd962cbba11fd03d67b56e2dfeb1c93'],
            _x: new BN(Buffer.from(SECRET, 'hex'), 16).toRed(bn128.q),
            isSameAddress: (a) => {
              return a[0] === '0x2f4176ab9fe2dce4517ab675f994335ed76eccf1461e2d90563cf477877bcb8d' && a[1] === '0x2fee819eb34f853582ef8398105d7e2fbfd962cbba11fd03d67b56e2dfeb1c93';
            },
            decrypt: () => {
              throw new Error('Bang!');
            },
            generateProof: () => {
              throw new Error(`Bang!`);
            },
          },
        },
      ]);
    });

    after(() => {
      ShieldedLocalWallet.prototype.getAccounts.resolves(LOCAL_ACCOUNTS);
    });

    it('withdraw() error handling - failed to generate proof', async () => {
      sinon.stub(tradeManager, '_decryptEncryptedBalance').resolves(150);
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED),
          })
        );
      await expect(
        tradeManager.withdraw('0xb60e8dd61c5d32be8058bb8eb970870f07233155', MOCK_ETH_SHIELD_ACCOUNT_MAPPING[0].ethAccount, MOCK_ETH_SHIELD_ACCOUNT_MAPPING[0].shieldedAccount, 100)
      ).to.eventually.be.rejectedWith('Proof generation failed.');
    });

    it('transfer() error handling - failed to generate proof', async () => {
      sinon.stub(Utils, 'shuffleAccountsWParityCheck').returns({ y: SIMULATED[0], index: [1, 0] });
      sinon.stub(tradeManager, '_decryptEncryptedBalance').resolves(150);
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED),
          })
        );

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await expect(tradeManager.transfer(zsc, ACCOUNTS[1].shieldedAccount, ACCOUNTS[0].shieldedAccount, 100)).to.eventually.be.rejectedWith(`Proof generation failed.`);

      Utils.shuffleAccountsWParityCheck.restore();
    });

    it('getBalance() error handling - failed to decrypt', async () => {
      let account = ['0x2f4176ab9fe2dce4517ab675f994335ed76eccf1461e2d90563cf477877bcb8d', '0x2fee819eb34f853582ef8398105d7e2fbfd962cbba11fd03d67b56e2dfeb1c93'];
      sinon.stub(tradeManager, 'findShieldedAccount').resolves({ shieldedAccount: account });
      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'net_version';
        })
        .reply(201, () =>
          rpc({
            result: '0x501c',
          })
        );

      nock('http://dummy.io')
        .post('/', (body) => {
          return body.method === 'eth_call';
        })
        .reply(201, () =>
          rpc({
            result: AbiCoder.encodeParameter('bytes32[2][2][]', SIMULATED),
          })
        );

      let zsc = '0x10f5e113ab47a33965d39d1f286683b4db0b688c';
      await expect(tradeManager.getBalance(zsc, '1')).to.eventually.be.rejectedWith('Failed to decrypt balance');
    });
  });
});
