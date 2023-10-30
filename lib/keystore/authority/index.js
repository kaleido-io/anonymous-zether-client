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

const { getAuthoritySigner } = require('../../config');
const { getLogger } = require('../../utils');
const logger = getLogger();

// Demostration of a highly privileged admin account
// For real usage, it would typically be based on an HSM device,
// or more sophisticated secure key management services
function getAccount(web3) {
  const privateKey = getAuthoritySigner();
  if (!privateKey) {
    logger.error('Authority signer not set');
    throw new Error('Authority signer not set');
  }

  const address = web3.eth.accounts.privateKeyToAccount(privateKey).address;
  return { address, privateKey };
}

module.exports = {
  getAccount,
};
