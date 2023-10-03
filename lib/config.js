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

const { join } = require('path');
const { homedir } = require('os');
const dotenv = require('dotenv');
dotenv.config();

const config = {
  dataDir: process.env.DATA_DIR || join(homedir(), 'zether'),
  erc20Address: process.env.ERC20_ADDRESS,
  zscAddress: process.env.ZSC_ADDRESS,
  chainId: process.env.CHAIN_ID,
  adminSigner: process.env.ADMIN_SIGNER,
  ethUrl: process.env.ETH_URL,
  epochLength: process.env.ZSC_EPOCH_LENGTH || 6,
};

function getDataDir() {
  return config.dataDir;
}

function getERC20Address() {
  return config.erc20Address;
}

function getZSCAddress() {
  return config.zscAddress;
}

function getChainId() {
  return config.chainId;
}

function getAdminSigner() {
  return config.adminSigner;
}

function getEthUrl() {
  return config.ethUrl;
}

function getEpochLength() {
  return config.epochLength;
}

module.exports = {
  getDataDir,
  getERC20Address,
  getZSCAddress,
  getChainId,
  getAdminSigner,
  getEthUrl,
  getEpochLength,
};
