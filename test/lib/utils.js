'use strict';

const chai = require('chai');
const expect = chai.expect;
const AbiEncoder = require('web3-eth-abi');
const Web3 = require('web3');

const utils = require('../../lib/utils');
const erc20ABI = require('../../lib/abi/erc20.json');
const bn128Utils = require('@anonymous-zether/anonymous.js/src/utils/utils');

const SIGNED_INVOKE_TX =
  '0xf8a70480830f42409428054fd76f7d111ca9bd4e3cad1591af3b65094980b844095ea7b3000000000000000000000000831795af932e726f76706e1d502ff0795d99356a000000000000000000000000000000000000000000000000000000000000001e820a96a03da40fb66d656808cb96507420bde2e37db98e40e65190981ef5dfb3806a88dda0725f8ea058eccaf404262ce57ff41a54ef0d6e4d453a1da19cf93856cc102e72';

describe('Signing tests', () => {
  let web3;

  before(() => {
    web3 = new Web3('ws://127.0.0.1:8545');
  });

  after(() => {
    web3.currentProvider.disconnect();
  });

  it('throws if web3 is missing', () => {
    expect(() => {
      utils.signTransaction();
    })
      .to.throw(Error)
      .that.match(/Missing required parameter "web3"/);
  });

  it('throws if payload is missing', () => {
    expect(() => {
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

  // For the following tests, accounts are generated with the following mnemonic
  // TEST_MNEMONIC = 'bone orchard able state tool unhappy describe candy attract enhance fluid boil';
  it('Signs a contract invoke transaction using index 1', async () => {
    const abi = erc20ABI[4];
    const params = {
      to: '0x28054fd76f7D111ca9Bd4e3CAd1591aF3B650949',
      nonce: '0x4',
      gasPrice: 0,
      gasLimit: 1000000,
      data: AbiEncoder.encodeFunctionCall(abi, ['0x831795aF932E726F76706E1d502ff0795d99356a', '30']),
    };
    const account = { address: '0x831795aF932E726F76706E1d502ff0795d99356a', privateKey: '1cf2397334fc328a82fb52219844f0f06bca57480d2cb7c9806736bb18bc91a7' };

    const signedTx = await utils.signTransaction(web3, params, account);
    expect(signedTx.rawTransaction).to.equal(SIGNED_INVOKE_TX);
  });

  it('Signs a contract invoke transaction using index 1 and alternative types of values', async () => {
    const abi = erc20ABI[4];
    const params = {
      to: '0x28054fd76f7D111ca9Bd4e3CAd1591aF3B650949',
      nonce: 4,
      gasPrice: '0x0',
      gasLimit: '0xf4240',
      data: AbiEncoder.encodeFunctionCall(abi, ['0x831795aF932E726F76706E1d502ff0795d99356a', '30']),
    };
    const account = { address: '0x831795aF932E726F76706E1d502ff0795d99356a', privateKey: '1cf2397334fc328a82fb52219844f0f06bca57480d2cb7c9806736bb18bc91a7' };

    const signedTx = await utils.signTransaction(web3, params, account);
    expect(signedTx.rawTransaction).to.equal(SIGNED_INVOKE_TX);
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
