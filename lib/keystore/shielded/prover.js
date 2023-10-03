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

const BN = require('bn.js');
const bn128 = require('@anonymous-zether/anonymous.js/src/utils/bn128.js');
const bn128Utils = require('@anonymous-zether/anonymous.js/src/utils/utils.js');
const { ElGamal } = require('@anonymous-zether/anonymous.js/src/utils/algebra.js');
const ZetherProver = require('@anonymous-zether/anonymous.js/src/prover/zether.js');
const BurnProver = require('@anonymous-zether/anonymous.js/src/prover/burn.js');
const { getLogger } = require('../../utils.js');
const logger = getLogger();
const { ZKP_PROOF_TYPE } = require('../../constants.js');

class Prover {
  constructor(x, y) {
    this.address = y;
    this._x = x;
  }

  // decrypts elgamal encrypted payload of the form (c1, c2)
  // elgamal encryption is of the form (g^b * y^r, g^r) where:
  //  - g is the generator of the group
  //  - b is the balance (the protected secret)
  //  - y is the public key, which is the result of g^x where x is the private key
  //  - r is the randomness used to encrypt the balance
  decrypt(payload) {
    const { c1, c2 } = payload;
    if (!c1 || !c2) {
      logger.error(`Decrypt error, Missing values of ciphertext c1 ${c1} or c2 ${c2}`);
      throw new Error(`Decrypt error, Missing values of ciphertext c1 ${c1} or c2 ${c2}`);
    }
    let c1Point, c2Point;
    try {
      c1Point = bn128.deserialize(c1);
      c2Point = bn128.deserialize(c2);
    } catch (err) {
      logger.error(`Error while deserializing: ${err}`);
      throw new Error(`Error while deserializing: ${err}`);
    }
    // use the private key, _x, to decrypt the payload
    // this returns g^b
    return c1Point.add(c2Point.mul(this._x.neg()));
  }

  // TODO: fill in the proof generation here so the account, as the prover key, can generate proofs
  // this way it does not need to disclose the private key and have it spilling outside of the account object
  async generateProof(payload) {
    if (!payload.type) {
      logger.error('Payload value for proof type cant be null');
      throw new Error('Payload value for proof type cant be null');
    }
    if (!payload.args) {
      logger.error('Payload value for proof args cant be null');
      throw new Error('Payload value for proof args cant be null');
    }
    let proof;
    // passing payload as option object but would be good to have serialize/deserialize based on proof type
    if (payload.type === ZKP_PROOF_TYPE.TRANSFER_PROOF) {
      try {
        const { anonSet, anonSetStates, value, index, randomness, balanceAfterTransfer, epoch } = payload.args;
        proof = this._generateTransferProof(anonSet, anonSetStates, value, index, randomness, balanceAfterTransfer, epoch);
      } catch (err) {
        logger.error(`Error while generating transfer proof: ${err}`);
        throw new Error(`Error while generating transfer proof: ${err}`);
      }
    } else if (payload.type === ZKP_PROOF_TYPE.BURN_PROOF) {
      try {
        const { burnAccount, burnAccountState, value, balanceAfterTransfer, epoch, sender } = payload.args;
        proof = this._generateBurnProof(burnAccount, burnAccountState, value, balanceAfterTransfer, epoch, sender);
      } catch (err) {
        logger.error(`Error while generating burn proof: ${err}`);
        throw new Error(`Error while generating burn proof: ${err}`);
      }
    } else {
      logger.error('Unknown value of proof type');
      throw new Error('Unknown value of proof type');
    }
    return proof;
  }

  _generateTransferProof(anonSet, anonSetStates, transferValue, index, randomness, balanceAfterTransfer, epoch) {
    // the randomness is represented as g^r
    const R = bn128.curve.g.mul(randomness);
    // C is the encrypted amount for each of the parties in the anonymity set:
    //  - y (party) is the public key of the party, y = g^x
    //  - for the sender, it's the negative of the amount to be sent, g^(-value) * y^(r)
    //  - for the recipient, it's the amount to be sent, g^(value) * y^(r)
    //  - for the decoys, it's zero, g^(0) * y^(r)
    const C = anonSet.map((party, i) => {
      let amount;
      if (i == index[0]) {
        // the sender, amount is minus the transfer value
        amount = new BN(-transferValue);
      } else if (i == index[1]) {
        // the receiver, amount is the transfer value
        amount = new BN(transferValue);
      } else {
        // the decoy, amount is 0
        amount = new BN(0);
      }
      // again the encrypted value is g^b * y^r
      const left = ElGamal.base.g.mul(amount).add(party.mul(randomness));
      return new ElGamal(left, R);
    });
    // the anonymity set states were downloaded from the smart contract, in serialized format, so we deserialize them first
    const deserialized = anonSetStates.map((state) => ElGamal.deserialize(state));
    // calculate the new values by applying the encrypted amount to each party's beginning (encrypted) amount
    const Cn = deserialized.map((state, i) => state.add(C[i]));

    const statement = {};
    statement.Cn = Cn;
    statement.C = C;
    statement.y = anonSet;
    statement.epoch = epoch;

    const witness = {};
    witness.sk = this._x;
    witness.r = randomness;
    witness.bTransfer = transferValue;
    witness.bDiff = balanceAfterTransfer;
    witness.index = index;

    const data = {};
    data.proof = ZetherProver.prove(statement, witness, 0).serialize();
    data.L = C.map((ciphertext) => bn128.serialize(ciphertext.left()));
    data.R = bn128.serialize(R);
    data.u = bn128.serialize(bn128Utils.u(epoch, this._x));
    return { ...data };
  }

  _generateBurnProof(burnAccount, burnAccountState, burnValue, balanceAfterTransfer, epoch, sender) {
    // the burn account state was downloaded from the smart contract, in serialized format, so we deserialized it first
    const deserialized = ElGamal.deserialize(burnAccountState);
    // calculate the encrypted amount after applying the burn value
    const Cn = deserialized.plus(new BN(-burnValue));

    const statement = {};
    statement.Cn = Cn;
    statement.y = burnAccount;
    statement.sender = sender;
    statement.epoch = epoch;

    const witness = {};
    witness.sk = this._x;
    witness.bDiff = balanceAfterTransfer;

    const data = {};
    data.proof = BurnProver.prove(statement, witness).serialize();
    data.u = bn128.serialize(bn128Utils.u(epoch, this._x));
    return { ...data };
  }
}

module.exports = Prover;
