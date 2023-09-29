'use strict';

const chai = require('chai');
const expect = chai.expect;
const Web3 = require('web3');
const nock = require('nock');

const utils = require('../../lib/utils');
const bn128Utils = require('@anonymous-zether/anonymous.js/src/utils/utils');

describe('Signing tests', () => {
  let web3;

  before(() => {
    web3 = new Web3('http://dummy:8545');
    let id;
    nock('http://dummy:8545')
      .persist()
      .post('/', (body) => {
        id = body.id;
        return body.method === 'eth_chainId';
      })
      .reply(201, () => {
        return {
          jsonrpc: '2.0',
          id,
          result: '0x501c',
        };
      });
  });

  after(() => {
    web3.currentProvider.disconnect();
  });

  it('throws if web3 is missing', async () => {
    await expect(() => {
      utils.signTransaction();
    })
      .to.throw(Error)
      .that.match(/Missing required parameter "web3"/);
  });

  it('throws if payload is missing', async () => {
    await expect(() => {
      utils.signTransaction(web3);
    })
      .to.throw(Error)
      .that.match(/Missing required parameter "payload"/);
  });

  it('throws if payload is an empty string', () => {
    expect(() => {
      utils.signTransaction(web3, '');
    })
      .to.throw(Error)
      .that.match(/Parameter "payload" must be an object/);
  });

  it('throws if payload has nonce that is a number with decimal', () => {
    expect(() => {
      utils.signTransaction(web3, { nonce: 1.2 });
    })
      .to.throw(Error)
      .that.match(/Failed to convert payload properties to hex/);
  });

  it('throws if payload has nonce that is not a 0x hex string', () => {
    expect(() => {
      utils.signTransaction(web3, { nonce: 'abcdef' });
    })
      .to.throw(Error)
      .that.match(/Parameter "payload.nonce" is detected as a string but not a valid "0x" prefixed hexidecimal number/);
  });

  it('shuffles accounts', async () => {
    const accounts = [];
    for (let i = 0; i < 8; i++) {
      const newAccount = bn128Utils.createAccount();
      accounts.push(newAccount.y);
    }
    const sender = accounts[0];
    const receiver = accounts[1];
    const { y, index } = utils.shuffleAccountsWParityCheck(accounts, sender, receiver);
    expect(y[index[0]]).deep.equal(sender);
    expect(y[index[1]]).deep.equal(receiver);
  });
});
