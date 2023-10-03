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

const { getAdminSigner } = require('../../config');
const { getLogger } = require('../../utils');
const logger = getLogger();

function getAccount(web3) {
  const privateKey = getAdminSigner();
  if (!privateKey) {
    logger.error('Admin signer not set');
    throw new Error('Admin signer not set');
  }

  const address = web3.eth.accounts.privateKeyToAccount(privateKey).address;
  return { address, privateKey };
}

module.exports = {
  getAccount,
};
