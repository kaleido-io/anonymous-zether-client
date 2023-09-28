'use strict';

const winston = require('winston');
const Web3Utils = require('web3-utils');
const AbiCoder = require('web3-eth-abi');
const crypto = require('crypto');
const Config = require('./config');

class HttpError extends Error {
  /**
   * Constructor
   * @param {*} message The error message
   * @param {*} statusCode The status code
   */
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode || 500;
  }

  /**
   * Sends a response with this message
   * Sets custom header with error message for bff
   * @param {*} res The Express response object
   * @param {*} requestId Custom request ID
   * @returns {*} nothing
   */
  send(res, requestId) {
    res.status(this.statusCode);
    res.send({
      requestId,
      errorMessage: this.message,
    });
  }
}

let globalMUX; // One for any operation anywhere that is doing writes
async function atomicRW(fcn) {
  // reading and updating the config must be done atomically across concurrent REST requests
  // set up a module-scoped control gate
  while (globalMUX) {
    await globalMUX;
  }
  // tie the control gate to the method-scoped promise
  let updatesComplete;
  globalMUX = new Promise((resolve) => {
    updatesComplete = resolve;
  });

  try {
    return await fcn();
  } finally {
    globalMUX = undefined;
    updatesComplete();
  }
}

function getLogger() {
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()],
  });
  return logger;
}

function getEpoch() {
  return Math.floor(new Date().getTime() / (Config.getEpochLength() * 1000));
}

function signTransaction(web3, payload, account) {
  if (typeof web3 === 'undefined') {
    throw new HttpError('Missing required parameter "web3"', 400);
  }

  if (typeof payload === 'undefined') {
    throw new HttpError('Missing required parameter "payload"', 400);
  }

  if (typeof payload !== 'object') {
    throw new HttpError('Parameter "payload" must be an object', 400);
  }

  if (typeof payload.nonce === 'string' && payload.nonce.match(/0x[0-9A-Fa-f]+/) === null) {
    throw new HttpError('Parameter "payload.nonce" is detected as a string but not a valid "0x" prefixed hexidecimal number', 400);
  }

  numberToHex(payload, 'nonce', true);
  numberToHex(payload, 'gasPrice');
  numberToHex(payload, 'gasLimit');

  let tx = Object.assign(
    {
      from: account.address,
      value: '0x0', // required eth transfer value, of course we don't deal with eth balances in private consortia
    },
    payload
  );

  let signedTx = web3.eth.accounts.signTransaction(payload, account.privateKey);

  return signedTx;
}

// attempt to get the reason for the transaction failure
// using eth_call and pass in the exact same input to execute the call on the
// target node directly without making it a transaction. Returned value is processed
// according to the control structure described at:
// https://solidity.readthedocs.io/en/v0.4.24/control-structures.html#error-handling-assert-require-revert-and-exceptions
async function getEVMRevertMessage(originalTxParam, web3, blockNumber) {
  const abi = [
    {
      inputs: [
        {
          internalType: 'address',
          name: '_ip',
          type: 'address',
        },
      ],
      stateMutability: 'nonpayable',
      type: 'constructor',
    },
    {
      inputs: [
        {
          components: [
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'CLn',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'CRn',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'y',
              type: 'tuple',
            },
            {
              internalType: 'uint256',
              name: 'epoch',
              type: 'uint256',
            },
            {
              internalType: 'address',
              name: 'sender',
              type: 'address',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'u',
              type: 'tuple',
            },
          ],
          internalType: 'struct BurnVerifier.BurnStatement',
          name: 'statement',
          type: 'tuple',
        },
        {
          components: [
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'BA',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'BS',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'T_1',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'T_2',
              type: 'tuple',
            },
            {
              internalType: 'uint256',
              name: 'tHat',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'mu',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'c',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 's_sk',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 's_b',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 's_tau',
              type: 'uint256',
            },
            {
              components: [
                {
                  components: [
                    {
                      internalType: 'bytes32',
                      name: 'x',
                      type: 'bytes32',
                    },
                    {
                      internalType: 'bytes32',
                      name: 'y',
                      type: 'bytes32',
                    },
                  ],
                  internalType: 'struct Utils.G1Point[]',
                  name: 'L',
                  type: 'tuple[]',
                },
                {
                  components: [
                    {
                      internalType: 'bytes32',
                      name: 'x',
                      type: 'bytes32',
                    },
                    {
                      internalType: 'bytes32',
                      name: 'y',
                      type: 'bytes32',
                    },
                  ],
                  internalType: 'struct Utils.G1Point[]',
                  name: 'R',
                  type: 'tuple[]',
                },
                {
                  internalType: 'uint256',
                  name: 'a',
                  type: 'uint256',
                },
                {
                  internalType: 'uint256',
                  name: 'b',
                  type: 'uint256',
                },
              ],
              internalType: 'struct InnerProductVerifier.InnerProductProof',
              name: 'ipProof',
              type: 'tuple',
            },
          ],
          internalType: 'struct BurnVerifier.BurnProof',
          name: 'proof',
          type: 'tuple',
        },
        {
          internalType: 'uint256',
          name: 'statementHash',
          type: 'uint256',
        },
        {
          components: [
            {
              internalType: 'uint256',
              name: 'y',
              type: 'uint256',
            },
            {
              internalType: 'uint256[32]',
              name: 'ys',
              type: 'uint256[32]',
            },
            {
              internalType: 'uint256',
              name: 'z',
              type: 'uint256',
            },
            {
              internalType: 'uint256[1]',
              name: 'zs',
              type: 'uint256[1]',
            },
            {
              internalType: 'uint256',
              name: 'zSum',
              type: 'uint256',
            },
            {
              internalType: 'uint256[32]',
              name: 'twoTimesZSquared',
              type: 'uint256[32]',
            },
            {
              internalType: 'uint256',
              name: 'x',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 't',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'k',
              type: 'uint256',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'tEval',
              type: 'tuple',
            },
          ],
          internalType: 'struct BurnVerifier.BurnAuxiliaries',
          name: 'burnAuxiliaries',
          type: 'tuple',
        },
        {
          components: [
            {
              internalType: 'uint256',
              name: 'c',
              type: 'uint256',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'A_y',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'A_b',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'A_t',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'gEpoch',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'A_u',
              type: 'tuple',
            },
          ],
          internalType: 'struct BurnVerifier.SigmaAuxiliaries',
          name: 'sigmaAuxiliaries',
          type: 'tuple',
        },
      ],
      name: 'VerifierError',
      type: 'error',
    },
    {
      anonymous: false,
      inputs: [
        {
          components: [
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'CLn',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'CRn',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'y',
              type: 'tuple',
            },
            {
              internalType: 'uint256',
              name: 'epoch',
              type: 'uint256',
            },
            {
              internalType: 'address',
              name: 'sender',
              type: 'address',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'u',
              type: 'tuple',
            },
          ],
          indexed: false,
          internalType: 'struct BurnVerifier.BurnStatement',
          name: 'statement',
          type: 'tuple',
        },
        {
          components: [
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'BA',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'BS',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'T_1',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'T_2',
              type: 'tuple',
            },
            {
              internalType: 'uint256',
              name: 'tHat',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'mu',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'c',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 's_sk',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 's_b',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 's_tau',
              type: 'uint256',
            },
            {
              components: [
                {
                  components: [
                    {
                      internalType: 'bytes32',
                      name: 'x',
                      type: 'bytes32',
                    },
                    {
                      internalType: 'bytes32',
                      name: 'y',
                      type: 'bytes32',
                    },
                  ],
                  internalType: 'struct Utils.G1Point[]',
                  name: 'L',
                  type: 'tuple[]',
                },
                {
                  components: [
                    {
                      internalType: 'bytes32',
                      name: 'x',
                      type: 'bytes32',
                    },
                    {
                      internalType: 'bytes32',
                      name: 'y',
                      type: 'bytes32',
                    },
                  ],
                  internalType: 'struct Utils.G1Point[]',
                  name: 'R',
                  type: 'tuple[]',
                },
                {
                  internalType: 'uint256',
                  name: 'a',
                  type: 'uint256',
                },
                {
                  internalType: 'uint256',
                  name: 'b',
                  type: 'uint256',
                },
              ],
              internalType: 'struct InnerProductVerifier.InnerProductProof',
              name: 'ipProof',
              type: 'tuple',
            },
          ],
          indexed: false,
          internalType: 'struct BurnVerifier.BurnProof',
          name: 'proof',
          type: 'tuple',
        },
        {
          indexed: false,
          internalType: 'bytes32',
          name: 'statementHash',
          type: 'bytes32',
        },
        {
          components: [
            {
              internalType: 'uint256',
              name: 'y',
              type: 'uint256',
            },
            {
              internalType: 'uint256[32]',
              name: 'ys',
              type: 'uint256[32]',
            },
            {
              internalType: 'uint256',
              name: 'z',
              type: 'uint256',
            },
            {
              internalType: 'uint256[1]',
              name: 'zs',
              type: 'uint256[1]',
            },
            {
              internalType: 'uint256',
              name: 'zSum',
              type: 'uint256',
            },
            {
              internalType: 'uint256[32]',
              name: 'twoTimesZSquared',
              type: 'uint256[32]',
            },
            {
              internalType: 'uint256',
              name: 'x',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 't',
              type: 'uint256',
            },
            {
              internalType: 'uint256',
              name: 'k',
              type: 'uint256',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'tEval',
              type: 'tuple',
            },
          ],
          indexed: false,
          internalType: 'struct BurnVerifier.BurnAuxiliaries',
          name: 'burnAuxiliaries',
          type: 'tuple',
        },
        {
          components: [
            {
              internalType: 'uint256',
              name: 'c',
              type: 'uint256',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'A_y',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'A_b',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'A_t',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'gEpoch',
              type: 'tuple',
            },
            {
              components: [
                {
                  internalType: 'bytes32',
                  name: 'x',
                  type: 'bytes32',
                },
                {
                  internalType: 'bytes32',
                  name: 'y',
                  type: 'bytes32',
                },
              ],
              internalType: 'struct Utils.G1Point',
              name: 'A_u',
              type: 'tuple',
            },
          ],
          indexed: false,
          internalType: 'struct BurnVerifier.SigmaAuxiliaries',
          name: 'sigmaAuxiliaries',
          type: 'tuple',
        },
      ],
      name: 'VerifierValues',
      type: 'event',
    },
    {
      inputs: [
        {
          components: [
            {
              internalType: 'bytes32',
              name: 'x',
              type: 'bytes32',
            },
            {
              internalType: 'bytes32',
              name: 'y',
              type: 'bytes32',
            },
          ],
          internalType: 'struct Utils.G1Point',
          name: 'CLn',
          type: 'tuple',
        },
        {
          components: [
            {
              internalType: 'bytes32',
              name: 'x',
              type: 'bytes32',
            },
            {
              internalType: 'bytes32',
              name: 'y',
              type: 'bytes32',
            },
          ],
          internalType: 'struct Utils.G1Point',
          name: 'CRn',
          type: 'tuple',
        },
        {
          components: [
            {
              internalType: 'bytes32',
              name: 'x',
              type: 'bytes32',
            },
            {
              internalType: 'bytes32',
              name: 'y',
              type: 'bytes32',
            },
          ],
          internalType: 'struct Utils.G1Point',
          name: 'y',
          type: 'tuple',
        },
        {
          internalType: 'uint256',
          name: 'epoch',
          type: 'uint256',
        },
        {
          components: [
            {
              internalType: 'bytes32',
              name: 'x',
              type: 'bytes32',
            },
            {
              internalType: 'bytes32',
              name: 'y',
              type: 'bytes32',
            },
          ],
          internalType: 'struct Utils.G1Point',
          name: 'u',
          type: 'tuple',
        },
        {
          internalType: 'address',
          name: 'sender',
          type: 'address',
        },
        {
          internalType: 'bytes',
          name: 'proof',
          type: 'bytes',
        },
      ],
      name: 'verifyBurn',
      outputs: [
        {
          internalType: 'bool',
          name: '',
          type: 'bool',
        },
      ],
      stateMutability: 'nonpayable',
      type: 'function',
    },
  ];
  const logger = getLogger();
  logger.info('Calling eth_call to find out details about evm revert failures');
  try {
    let execResult = await web3.eth.call(originalTxParam, blockNumber);
    logger.info(`Result: ${execResult}`);
  } catch (err) {
    const customError = abi.find((def) => def.name === 'VerifierError');
    const decoded = AbiCoder.decodeParameters(customError.inputs, err.data.slice(10));
    logger.info(`Decoded: ${JSON.stringify(decoded, null, 2)}`);
  }

  let ERROR_MARKER = '0x08c379a0';
  let PREFIX_LENGTH = ERROR_MARKER.length + 128;
  /* istanbul ignore else */
  if (execResult && execResult.indexOf(ERROR_MARKER) === 0 && execResult.length > PREFIX_LENGTH) {
    let offset = execResult.slice(10, 74); // first 32 bytes after the error marker are the offset
    offset = Web3Utils.hexToNumber('0x' + offset);

    let errlen = execResult.slice(74, 138); // next 32 bytes are the length of error string
    errlen = Web3Utils.hexToNumber('0x' + errlen);

    let end = PREFIX_LENGTH + errlen * 2; // error string length is in bytes, for hex string need to multiply by 2
    if (end > execResult.length) end = execResult.length;

    let errorString = execResult.slice(PREFIX_LENGTH, end);
    errorString = Web3Utils.hexToString('0x' + errorString);

    throw new Error(`Contract returned error: ${errorString}. Offset: ${offset}`);
  }
}

function numberToHex(payload, property, required) {
  if ((payload[property] || required) && typeof payload[property] === 'number') {
    try {
      payload[property] = Web3Utils.numberToHex(payload[property]);
    } catch (err) {
      getLogger().error(`Failed to convert payload.${property} ${payload[property]} to hex`, err);
      throw new HttpError(`Failed to convert payload properties to hex`, 400);
    }
  }
}

// shuffleAccountsWParityCheck, shuffles the public keys used in anonymity set of a transaction.
// returns shuffled array, and indices of sender and receiver in that array.
// protocol requires that indices of sender and receiver are of opposite parity in the shuffled array.
// so function shifts receiver keys to one position left to right in the array if shuffle results in
// sender and receiver being at indices with same parity.
function shuffleAccountsWParityCheck(y, sender, receiver) {
  const index = [];
  let m = y.length;
  // shuffle the array of y's
  while (m !== 0) {
    // https://bost.ocks.org/mike/shuffle/
    const i = crypto.randomBytes(1).readUInt8() % m--; // warning: N should be <= 256. also modulo bias.
    const temp = y[i];
    y[i] = y[m];
    y[m] = temp;
    if (sender.eq(temp)) index[0] = m;
    else if (receiver.eq(temp)) index[1] = m;
  }
  // make sure you and your friend have opposite parity (one at odd position, one at even position)
  if (index[0] % 2 === index[1] % 2) {
    const temp = y[index[1]];
    y[index[1]] = y[index[1] + (index[1] % 2 === 0 ? 1 : -1)];
    y[index[1] + (index[1] % 2 === 0 ? 1 : -1)] = temp;
    index[1] = index[1] + (index[1] % 2 === 0 ? 1 : -1);
  }

  return { y, index };
}

function estimatedTimeForTxCompletion(anonSetSize) {
  return Math.ceil(((anonSetSize * Math.log(anonSetSize)) / Math.log(2)) * 20 + 5200) + 20;
}

function timeBeforeNextEpoch() {
  const current = new Date().getTime() / 1000;
  const epochLength = Config.getEpochLength();
  return Math.ceil(current / epochLength) * epochLength - current;
}

function isEthereumAddress(address) {
  return address.match(/^0x[0-9a-fA-F]{40}$/);
}

function isShieldedAddress(address) {
  return address.match(/^0x[0-9a-f]{64},0x[0-9a-f]{64}$/);
}

module.exports = {
  HttpError,
  getLogger,
  atomicRW,
  getEpoch,
  signTransaction,
  shuffleAccountsWParityCheck,
  estimatedTimeForTxCompletion,
  timeBeforeNextEpoch,
  getEVMRevertMessage,
  isEthereumAddress,
  isShieldedAddress,
};
