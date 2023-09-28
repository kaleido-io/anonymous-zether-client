'use strict';

const { getAdminSigner } = require('../../config');
const { getLogger } = require('../../utils');
const logger = getLogger();

function getAccount (web3) {
  const privateKey = getAdminSigner();
  if (!privateKey) {
    logger.error('Admin signer not set');
    throw new Error('Admin signer not set');
  }

  const address = web3.eth.accounts.privateKeyToAccount(privateKey).address;
  return { address, privateKey };
}

module.exports = {
  getAccount
};
