'use strict';

const ZKP_PROOF_TYPE = {
  // zero knowledge proof for token transfer between zether accounts
  TRANSFER_PROOF: 'transferproof',
  // zero knowledge proof for withdrawing zether tokens out of zether account
  BURN_PROOF: 'burnproof'
};

const ZKP_PROTOCOL_MULTIPLIER = {
  QBFT: 1,
  RAFT: 1000000000
};

const TTL = 100000;
const ETH_SHIELD_ACCOUNT_MAPPING = 'eth-shield-account-mapping.json';
const RECOVER_BALANCE_CACHE_FILE = 'recover-balance-cache.csv';
const CACHE_LIMIT = 200000;

module.exports = {
  ETH_SHIELD_ACCOUNT_MAPPING,
  ZKP_PROOF_TYPE,
  ZKP_PROTOCOL_MULTIPLIER,
  TTL,
  RECOVER_BALANCE_CACHE_FILE,
  CACHE_LIMIT
};
