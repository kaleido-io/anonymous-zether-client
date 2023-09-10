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

module.exports = {
  getDataDir,
  getERC20Address,
  getZSCAddress,
  getChainId,
  getAdminSigner,
  getEthUrl,
};
