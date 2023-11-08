// Copyright © 2023 Kaleido, Inc.
//
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';

const ZKP_PROOF_TYPE = {
  // zero knowledge proof for token transfer between zether accounts
  TRANSFER_PROOF: 'transferproof',
  // zero knowledge proof for withdrawing zether tokens out of zether account
  BURN_PROOF: 'burnproof',
};

const ZKP_PROTOCOL_MULTIPLIER = {
  QBFT: 1,
  RAFT: 1000000000,
};

const TTL = 100000;
const ETH_SHIELD_ACCOUNT_MAPPING = 'eth-shield-account-mapping.json';
const RECOVER_BALANCE_CACHE_FILE = 'recover-balance-cache.csv';
const CACHE_LIMIT = 200000;
const ONETIME_KEYS = 'onetime-keys';

module.exports = {
  ETH_SHIELD_ACCOUNT_MAPPING,
  ZKP_PROOF_TYPE,
  ZKP_PROTOCOL_MULTIPLIER,
  TTL,
  RECOVER_BALANCE_CACHE_FILE,
  CACHE_LIMIT,
  ONETIME_KEYS,
};
