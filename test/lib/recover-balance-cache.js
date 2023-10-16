'use strict';
const NodeCache = require('node-cache');
const sinon = require('sinon');
const chai = require('chai');
chai.use(require('sinon-chai'));
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const fs = require('fs');
const timers = {
  sleep: require('util').promisify(require('timers').setTimeout),
};
const bn128 = require('@anonymous-zether/anonymous.js/src/utils/bn128.js');

describe('recover-balance-test.js', () => {
  let RecoverBalanceCache, recoverBalanceCache, nodeCache;
  before(async () => {
    RecoverBalanceCache = require('../../lib/trade-manager/balance-cache');
    nodeCache = new NodeCache({ stdTTL: 3, checkperiod: 1, useClones: false, maxKeys: 15, deleteOnExpire: true });
    recoverBalanceCache = new RecoverBalanceCache(10);
    recoverBalanceCache.init(nodeCache);
    const readStreamObj = await fs.createReadStream('test/resources/test-balance-cache.csv');
    const noHeadersStreamObj = await fs.createReadStream('test/resources/test-balance-cache-no-headers.csv');
    const corrruptedEntriesObj = await fs.createReadStream('test/resources/test-balance-cache-corrupted.csv');
    sinon.stub(RecoverBalanceCache.fs, 'createReadStream').onCall(0).resolves(readStreamObj).onCall(1).rejects().onCall(2).resolves(noHeadersStreamObj).onCall(3).resolves(corrruptedEntriesObj);
  });
  beforeEach(async () => {
    await recoverBalanceCache.flush();
  });
  it('populateBalanceRange populates cache with range of values', async () => {
    await recoverBalanceCache.populateBalanceRange(100, 10);
    const stats = recoverBalanceCache.getStats();
    expect(stats.keys).to.be.equal(10);
  });
  it('populateBalanceRange attempts to populates cache with more than maxKey pairs', async () => {
    await recoverBalanceCache.populateBalanceRange(0, 40);
    const stats = recoverBalanceCache.getStats();
    expect(stats.keys).to.be.equal(10);
  });
  it('delBalanceRange deletes cache with range of values', async () => {
    await recoverBalanceCache.populateBalanceRange(100, 5);
    let stats = recoverBalanceCache.getStats();
    expect(stats.keys).to.be.equal(5);
    await recoverBalanceCache.delBalanceRange(100, 10);
    stats = recoverBalanceCache.getStats();
    expect(stats.keys).to.be.equal(0);
  });
  it('get hits cached value', async () => {
    await recoverBalanceCache.populateBalanceRange(100, 10);
    const key = bn128.curve.g.mul(105);
    const value = await recoverBalanceCache.get(key, function () {
      return Promise.resolve(105);
    });
    expect(value).to.be.equal(105);
    const stats = recoverBalanceCache.getStats();
    expect(stats.hits).to.be.equal(1);
    expect(stats.keys).to.be.equal(10);
  });
  it('get misses', async () => {
    const key = bn128.curve.g.mul(105);
    const value = await recoverBalanceCache.get(key, function () {
      return Promise.resolve(105);
    });
    expect(value).to.be.equal(105);
    const stats = recoverBalanceCache.getStats();
    expect(stats.hits).to.be.equal(0);
    expect(stats.misses).to.be.equal(1);
    expect(stats.keys).to.be.equal(1);
  });
  it('populateCacheFromFile populates cache using a csv file', async () => {
    await recoverBalanceCache.populateCacheFromFile('balance-cache.csv');
    const stats = recoverBalanceCache.getStats();
    expect(stats.keys).to.be.equal(10);
  });
  it('populateCacheFromFile error handling', async () => {
    // no file
    await expect(recoverBalanceCache.populateCacheFromFile('balance-cache.csv')).to.be.eventually.rejectedWith('Cache file not found.');
    // no headers
    await expect(recoverBalanceCache.populateCacheFromFile('balance-cache.csv')).to.be.eventually.rejectedWith('File is not well formed.');
    // corrruptedEntries, 1 entry is corrupted
    await recoverBalanceCache.populateCacheFromFile('balance-cache.csv');
    const stats = recoverBalanceCache.getStats();
    expect(stats.keys).to.be.equal(9);
  });
  it('Make sure entries are deleted on expiry if deleteOnExpire is true', async () => {
    await recoverBalanceCache.populateBalanceRange(100, 5);
    await timers.sleep(4500);
    const stats = recoverBalanceCache.getStats();
    expect(stats.keys).to.be.equal(0);
  }).timeout(5000);

  it('Make sure entries are not deleted on expiry if deleteOnExpire is false', async () => {
    nodeCache = new NodeCache({ stdTTL: 2, checkperiod: 1, useClones: false, maxKeys: 15, deleteOnExpire: false });
    recoverBalanceCache = new RecoverBalanceCache(15);
    recoverBalanceCache.init(nodeCache);
    await recoverBalanceCache.populateBalanceRange(100, 15);
    // check if you are able to access keys
    const key = bn128.curve.g.mul(105);
    await timers.sleep(2000);
    const stats = recoverBalanceCache.getStats();
    expect(stats.keys).to.be.equal(15);
    const value = await recoverBalanceCache.get(key, function () {
      return Promise.resolve(101);
    });
    expect(value).to.be.equal(105);
  }).timeout(3500);
});
