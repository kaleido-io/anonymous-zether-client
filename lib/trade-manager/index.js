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

const CashTokenClient = require('./cash-token');
const ZetherTokenClient = require('./zether-token');

//
// Manages interactions with the cash token and the anonymous zether token contracts
//
class TradeManager {
  constructor(ethWalletManager, shieldedWallet) {
    this.cashTokenClient = new CashTokenClient(ethWalletManager);
    this.zetherTokenClient = new ZetherTokenClient(ethWalletManager, shieldedWallet, this.cashTokenClient);
  }

  async init() {
    await this.zetherTokenClient.init();
  }
}

module.exports = TradeManager;
