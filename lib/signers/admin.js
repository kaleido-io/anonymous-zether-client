'use strict';

const Accounts = require('web3-eth-accounts');
const { getAdminSigner } = require('../config');
const { getLogger } = require('../utils');
const logger = getLogger();
const accounts = new Accounts();

async function getAccount() {
  const privateKey = getAdminSigner();
  if (!privateKey) {
    logger.error('Admin signer not set');
    throw new Error('Admin signer not set');
  }

  const address = accounts.privateKeyToAccount(privateKey);
  return { address, privateKey };
}

module.exports = {
  getAccount,
};
