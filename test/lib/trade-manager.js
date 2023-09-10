'use strict';

const chai = require('chai');
const expect = chai.expect;
const AbiEncoder = require('web3-eth-abi');

const TradeManager = require('../../lib/trade-manager.js');
const approveABI = require('../../lib/abi/approve.json');

const SIGNED_INVOKE_TX =
  '0xf8a50480830f42409428054fd76f7d111ca9bd4e3cad1591af3b65094980b844095ea7b3000000000000000000000000831795af932e726f76706e1d502ff0795d99356a000000000000000000000000000000000000000000000000000000000000001e26a06bb18a693bfd02934343b1892c58c67f67a583e0fea493aba736ac0fad4f7d51a01a7bf3b893592414ba6393e7e97cbc2ac632da53a3a314a098cf7e6ab1f707fc';

describe('Signing tests', () => {
  it('throws if payload is missing', () => {
    expect(() => {
      TradeManager.signTransaction();
    })
      .to.throw(Error)
      .that.match(/Missing required parameter "payload"/);
  });

  it('throws if payload is an empty string', () => {
    expect(() => {
      TradeManager.signTransaction('');
    })
      .to.throw(Error)
      .that.match(/Parameter "payload" must be an object/);
  });

  it('throws if payload has nonce that is a number with decimal', () => {
    expect(() => {
      TradeManager.signTransaction({ nonce: 1.2 });
    })
      .to.throw(Error)
      .that.match(/Failed to convert payload properties to hex/);
  });

  it('throws if payload has nonce that is not a 0x hex string', () => {
    expect(() => {
      TradeManager.signTransaction({ nonce: 'abcdef' });
    })
      .to.throw(Error)
      .that.match(/Parameter "payload.nonce" is detected as a string but not a valid "0x" prefixed hexidecimal number/);
  });

  // For the following tests, accounts are generated with the following mnemonic
  // TEST_MNEMONIC = 'bone orchard able state tool unhappy describe candy attract enhance fluid boil';
  it('Signs a contract invoke transaction using index 1', () => {
    const abi = approveABI[0];
    let params = {
      to: '0x28054fd76f7D111ca9Bd4e3CAd1591aF3B650949',
      nonce: '0x4',
      gasPrice: 0,
      gasLimit: 1000000,
      data: AbiEncoder.encodeFunctionCall(abi, ['0x831795aF932E726F76706E1d502ff0795d99356a', '30']),
    };
    let account = { address: '0x831795aF932E726F76706E1d502ff0795d99356a', privateKey: '1cf2397334fc328a82fb52219844f0f06bca57480d2cb7c9806736bb18bc91a7' };

    let signedTx = TradeManager.signTransaction(params, account);
    expect(signedTx.serializedTx).to.equal(SIGNED_INVOKE_TX);
  });

  it('Signs a contract invoke transaction using index 1 and alternative types of values', () => {
    const abi = approveABI[0];
    let params = {
      to: '0x28054fd76f7D111ca9Bd4e3CAd1591aF3B650949',
      nonce: 4,
      gasPrice: '0x0',
      gasLimit: '0xf4240',
      data: AbiEncoder.encodeFunctionCall(abi, ['0x831795aF932E726F76706E1d502ff0795d99356a', '30']),
    };
    let account = { address: '0x831795aF932E726F76706E1d502ff0795d99356a', privateKey: '1cf2397334fc328a82fb52219844f0f06bca57480d2cb7c9806736bb18bc91a7' };

    let signedTx = TradeManager.signTransaction(params, account);
    expect(signedTx.serializedTx).to.equal(SIGNED_INVOKE_TX);
  });
});
