'use strict';

const chai = require('chai');
const expect = chai.expect;

const Generator = require('../../../../lib/keystore/hdwallet/generator.js');

const TEST_MNEMONIC = 'bone orchard able state tool unhappy describe candy attract enhance fluid boil';

describe('Single account generation tests', () => {
  it('Validates the account generated at index 0, 10', async () => {
    let account = await new Generator(TEST_MNEMONIC).generateNodes([0]);
    expect(account).to.be.an('array');
    expect(account.length).to.equal(1);
    expect(account[0]).to.have.property('address');
    expect(account[0].address).to.equal('0x28AAf3AAe78275FC0958669f643C13C75Eb3b847');
    expect(account[0].privateKey).to.equal('845655f1e9e7c02979d85f6b0e1edae8b925164f4d40cde5e4883fad6b6f2c96', 'hex');

    account = await new Generator(TEST_MNEMONIC).generateNodes([10]);
    expect(account[0].address).to.equal('0x2bE26554557Cc4DD4f9A23434d7792b13bE25B58');
  });
});

describe('Range of accounts generation tests', () => {
  it('Validates the account generated at indices 0 - 9', async () => {
    const account = await new Generator(TEST_MNEMONIC).generateNodes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(account).to.be.an('array');
    expect(account.length).to.equal(10);
    expect(account[0].address).to.equal('0x28AAf3AAe78275FC0958669f643C13C75Eb3b847');
    expect(account[0].privateKey).to.equal('845655f1e9e7c02979d85f6b0e1edae8b925164f4d40cde5e4883fad6b6f2c96', 'hex');
    expect(account[9].address).to.equal('0xb1e4A8Fc291BDC12217c9F1317E116a05f5ead1e');
  });
});
