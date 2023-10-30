'use strict';

const { join } = require('path');
const os = require('os');

let nextRPCId = 1;
/**
 * @param {object} obj The original result object
 * @returns {object} original object enhanced with the rpc id
 */
function rpc(obj) {
  obj.id = nextRPCId++;
  obj.jsonrpc = '2.0';
  return obj;
}

function reset(setup) {
  delete require.cache[require.resolve('../../lib/keystore/admin')];
  delete require.cache[require.resolve('../../lib/keystore/hdwallet')];
  delete require.cache[require.resolve('../../lib/keystore/shielded')];
  delete require.cache[require.resolve('../../lib/trade-manager')];
  delete require.cache[require.resolve('../../lib/trade-manager/cash-token')];
  delete require.cache[require.resolve('../../lib/trade-manager/zether-token')];
  delete require.cache[require.resolve('../../lib/trade-manager/base')];
  delete require.cache[require.resolve('../../lib/wallet-manager.js')];
  delete require.cache[require.resolve('../../lib/utils.js')];
  delete require.cache[require.resolve('../../lib/config.js')];
  delete process.env.ERC20_ADDRESS;
  delete process.env.ZSC_ADDRESS;
  delete process.env.ZSC_EPOCH_LENGTH;
  delete process.env.CHAIN_ID;
  delete process.env.ADMIN_SIGNER;
  delete process.env.ETH_URL;
  delete process.env.DATA_DIR;
  setup();
}

function fullSetup(name) {
  const tmpdir = join(os.tmpdir(), name);
  reset(() => {
    process.env.ERC20_ADDRESS = process.env.ERC20_ADDRESS_TEST;
    process.env.ZSC_ADDRESS = process.env.ZSC_ADDRESS_TEST;
    process.env.ZSC_EPOCH_LENGTH = 6;
    process.env.CHAIN_ID = 1337;
    process.env.ADMIN_SIGNER = '0x950e0c1d6d719c65104bdeed2bd1ff97781cf90f1334abfe80e140ded4c40d21';
    process.env.AUTHORITY_SIGNER = '0x950e0c1d6d719c65104bdeed2bd1ff97781cf90f1334abfe80e140ded4c40d21';
    process.env.ETH_URL = 'ws://127.0.0.1:8545';
    process.env.DATA_DIR = tmpdir;
  });
  return tmpdir;
}

module.exports = {
  rpc,
  reset,
  fullSetup,
};
