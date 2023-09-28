'use strict';
const { soliditySha3 } = require('web3-utils');
const csv = require('csv-parser');
const fs = require('fs-extra');
const { join } = require('path');
const bn128 = require('@anonymous-zether/anonymous.js/src/utils/bn128.js');
const { getLogger, atomicRW } = require('./utils');
const logger = getLogger('recover-balance-cache.js');

class RecoverBalanceCache {
  // temporary fix before node-cache incorporates it in their release
  constructor (maxKeysAllowed) {
    this.maxKeysAllowed = maxKeysAllowed;
    this.numKeys = 0;
  }

  init (Cache) {
    this.cache = Cache;
  }

  /*
    returns stats object of the form
		{
			keys: 0,    // global key count
			hits: 0,    // global hit count
			misses: 0,  // global miss count
			ksize: 0,   // global key size count in approximately bytes
			vsize: 0    // global value size count in approximately bytes
		}
	*/
  getStats () {
    return this.cache.getStats();
  }

  // populates cache with (key,value) for balances startBalance, startBalance+1, ... startBalance+count-1 or if cache is filled up drop it
  populateBalanceRange (startBalance, count) {
    let isSet;
    let gBalance = bn128.curve.g.mul(startBalance);
    for (let i = 0; i < count; i++) {
      if (this.numKeys >= this.maxKeysAllowed) {
        logger.error(`Set failed due cache full, Set only ${i} out of ${count} keys in cache.`);
        return;
      }
      isSet = this.cache.set(getKey(gBalance), i + startBalance);
      if (!isSet) {
        logger.error(`Set failed, Set only ${i} out of ${count} keys in cache.`);
        return;
      }
      this.numKeys += 1;
      gBalance = gBalance.add(bn128.curve.g);
    }
  }

  // populate cache from the file
  // csv file is contains comma separated (key, value)
  async populateCacheFromFile (cacheFileName) {
    let isSet, readStream;
    const dataDir = join(__dirname, 'resources');
    return await atomicRW(async () => {
      return new Promise(
        async function (resolve, reject) {
          try {
            readStream = await fs.createReadStream(join(dataDir, cacheFileName));
            readStream.on('error', (err) => {
              logger.warn('Error in read stream.');
              return reject(err);
            });
            readStream
              .pipe(csv())
              .on('headers', (Headers) => {
                if (Headers[0] !== 'key' || Headers[1] !== 'value') {
                  return reject('File is not well formed.');
                }
              })
              .on('data', (row) => {
                if (row.key && row.value && this.numKeys < this.maxKeysAllowed && validateKeyValue(row.key, row.value)) {
                  isSet = this.cache.set(row.key, Number(row.value));
                  if (isSet) {
                    this.numKeys += 1;
                  }
                }
              })
              .on('error', (error) => {
                return reject(error);
              })
              .on('end', () => {
                logger.info(`Populated the cache successfully with file ${join(dataDir, cacheFileName)}`);
                return resolve();
              });
          } catch (err) {
            logger.warn(`Cache file ${join(dataDir, cacheFileName)} not found`);
            return reject('Cache file not found.');
          }
        }.bind(this)
      );
    });
  }

  // deletes cache with (key,value) for balances startBalance, startBalance+1, ... startBalance+count-1
  delBalanceRange (startBalance, count) {
    let gBalance = bn128.curve.g.mul(startBalance);
    for (let i = 0; i < count; i++) {
      this.numKeys -= this.cache.del(getKey(gBalance));
      gBalance = gBalance.add(bn128.curve.g);
    }
  }

  // fetches key from cache, if not present resolve it using resolveCacheMiss function
  get (gBalance, resolveCacheMiss) {
    const key = getKey(gBalance);
    const balance = this.cache.get(key);
    if (balance) {
      logger.info('cache hit.');
      // reset TTL with default;
      this.cache.ttl(key);
      return balance;
    }
    logger.info('cache miss.');
    try {
      const result = resolveCacheMiss(gBalance);
      if (this.numKeys >= this.maxKeysAllowed) {
        logger.err(`Set failed due cache full, couldn't set ${key} in cache.`);
        return result;
      }
      const isSet = this.cache.set(key, result);
      if (!isSet) {
        logger.err(`Set failed, couldn't set ${key} in cache.`);
        return result;
      }
      return result;
    } catch (e) {
      logger.warn(e);
      throw e;
    }
  }

  // flushes out everything
  flush () {
    this.cache.flushAll();
    this.numKeys = 0;
  }
}

function validateKeyValue (keyStr, valueStr) {
  return keyStr.match(/^0x[0-9a-f]{64}$/) && !isNaN(valueStr);
}

function getKey (ecPoint) {
  if (ecPoint.isInfinity()) {
    return 'INF';
  }
  return soliditySha3(ecPoint.getX().toString(16, 64) + ecPoint.getY().toString(16, 64));
}

RecoverBalanceCache.fs = fs;
module.exports = RecoverBalanceCache;
