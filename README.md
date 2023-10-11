# Overview

A sample client implementation for [anonymous-zether](https://github.com/Consensys/anonymous-zether) that demonstrates these essential features to use the Anonymous Zether protocol in a solution:

- a REST interface
- key management: the client manages 3 types of signing accounts:
  - one-time signing keys for submitting zether transfer transactions
  - managed wallet that can easily dispense billions of signing keys to use by authenticated users. This can be handy if an application wants to present to their end users a web2 experience without requiring them to manage signing keys. A typical technique is mapping user identities (such as OIDC subject ID) to signing keys such that each authenticated user has their own signing account
  - an admin account that was used to deploy the ERC20 contract, which has the minting privileges
- pre-calculated cache to resolve the balance. After decrypting the onchain state that represents an account's Zether balance, the application gets the `g^b` value, where `b` is the actual balance. This step requires brute force computation to resolve the value `b`. A cache is provided for all values of `b` in the range 0 - 100,000 to allow this step to be completed instantaneously.

# Dependency

anonymous-zether is not published as an NPM module, so you must check out the repository to fulfill the dependency.

Checkout the repository [anonymous-zether](https://github.com/kaleido-io/anonymous-zether) so that it's peer to the root of this repository. This is a fork of the ConsenSys repository, that switches to hardhat rather than truffle to handle the deployment of smart contracts for local testing.

> Note: the default branch of the repository is `hardhat`. This is the branch you need.

Then you can `npm i` or `yarn` to install the dependencies.

# Launch

Follow the steps below to have a working system.

## Blockchain network

The client works with any Ethereum JSON-RPC endpoint, such as a local node for testing purposes, or a permissioned network hosted in Kaleido.

You can get a local Ethereum node running easily by using Hardhat. Go to the project `anonymous-zether` checked out above, and launch the local node using Hardhat:

```console
$ cd anonymous-zether/packages/protocol
$ npm i
$ npm run node
Started HTTP and WebSocket JSON-RPC server at http://127.0.0.1:8545/

Accounts
========

WARNING: These accounts, and their private keys, are publicly known.
Any funds sent to them on Mainnet or any other live network WILL BE LOST.

Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (10000 ETH)
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

Account #1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (10000 ETH)
Private Key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d

...

Account #19: 0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199 (10000 ETH)
Private Key: 0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e

WARNING: These accounts, and their private keys, are publicly known.
Any funds sent to them on Mainnet or any other live network WILL BE LOST.
```

## Deploy Contracts

First make sure the smart contracts are deployed properly. To make Zether work, you need an ERC20 and Zether deployed, plus their dependencies.

The easiest way to deploy is using the Hardhat script in the project anonymous-zether in the `packages/protocol` folder:

```console
$ cd anonymous-zether/packages/protocol
$ npm i
$ npm run deploy:local

> @anonymous-zether/protocol@0.1.0 deploy:local
> npx hardhat run scripts/deploy.js --network localTest

CashToken contract deployed to  0x8Cc6306EEf90449F21DAF5A86235f5CEA842f76a
InnerProductVerifier deployed to  0xc1f50fdF37F6728410f8F6f95d9D7D7bA38fD36b
ZetherVerifier deployed to  0x7FDA58D485709dC2b89911B3745F8C31216DF8C8
BurnVerifier deployed to  0x0cC899AffB373A2Eb12122f00585539885CcD217
ZSC deployed to  0xd194EeBB3AF65697BFc18b8bf4edC3454A0B8bAd
```

## Configurations

The app takes configurations in the form of environment variables. They can be provided separately or via the `.env` file in the same folder as the `app.js`. A sample copy has been provided in the file `.env.sample` so you just need to copy that to file named `.env` in the same folder and update the values according to your blockchain environment.

> The existence of the `.env` file will interfere with unit tests, which relies on test instrumentation for some of the failure tests. Please make sure to delete `.env` before running the unit test suite

## Launch the server

```console
$ node app.js
2023-10-11T17:28:02.103Z [INFO] Successfully opened connection to key DB at /Users/jimzhang/Documents/tmp/zether/keysdb
2023-10-11T17:28:02.109Z [INFO] Initialized HD Wallet for submitting transactions
2023-10-11T17:28:02.524Z [INFO] Populating the balance cache from file...
2023-10-11T17:28:02.732Z [INFO] Populated the cache successfully with file /Users/jimzhang/workspace.brazil/zether-client/lib/resources/recover-balance-cache.csv
2023-10-11T17:28:02.733Z [INFO] Successfully opened connection to key DB at /Users/jimzhang/Documents/tmp/zether/keysdb
2023-10-11T17:28:02.762Z [INFO] Configurations:
2023-10-11T17:28:02.762Z [INFO] 	    data dir: /Users/jimzhang/Documents/tmp/zether
2023-10-11T17:28:02.762Z [INFO] 	     eth URL: ws://127.0.0.1:8545
2023-10-11T17:28:02.762Z [INFO] 	    chain ID: 1337
2023-10-11T17:28:02.762Z [INFO] 	       erc20: 0x8485182Cf7A168c0099B86776886Bac73AD6233F
2023-10-11T17:28:02.762Z [INFO] 	         ZSC: 0x5262Ab7CeD3ad85514B0C131dA41Bf6e5fe858D2
2023-10-11T17:28:02.762Z [INFO] 	epoch length: 6 seconds
2023-10-11T17:28:02.763Z [INFO] Listening on port 3000
```

# API Reference

### Create a pair of ethereum and shielded accounts

The client uses a 1-1 mapping between Ethereum signing accounts and Shielded accounts.

```console
$ curl -H "Content-Type: application/json" -d {} http://localhost:3000/api/v1/accounts
{
  "eth": "0x1A3e76010Fa50764378078aD5CfE71b271559D70",
  "shielded": [
    "0x17872c1b0dbe8f96f3909025d8628d30d479ebcacfb1fcf809f8f3a2778691d9",
    "0x071cb2add5a05a8544bc8ea1b267d9fc5330ac20b2aeb4a36a459da8ea5a6e68"
  ]
}
```

### Look up hosted accounts

```console
$ curl -H "Content-Type: application/json" http://localhost:3000/api/v1/accounts
{
  "0xd6538eb66ED15247dD4C0370fc4388e197DF7F95": [
    "0x254dd333d42266a3482817b70c9d0820a2a61f3d083db0bf067c2c4c48979609",
    "0x12ca7a2944688563b17223652501d6e2ceaaf3bb0586cc03903b5810e0556bbf"
  ],
  "0x6d6052B851E6EBfae1458e23BbD1119F182cda05": [
    "0x22c5f8e5aa98b26c741756c2c06887ab42cf5512649afb70461229214ba4b9c2",
    "0x230778e08977c0d03cad5ab1d5d67439bb886b912745ebc66495ae2229f60094"
  ],
  "0x173Fdf2C4845D61dB0CB93B789154475aff30729": [
    "0x088e0c151ce3828ac25245a6fd56977f986ae3bb3724651b4bf7b49ed45f1269",
    "0x083c23057e981fc55494300414be6ddb4b42f9c6a4c8e6f989cf9419c2cff3c8"
  ]
}
```

### Mint ERC20 tokens

This gives ethereum accounts some ERC20 tokens, which then can be deposited to their corresponding shielded accounts for secure transfers.

```console
$ curl -H "Content-Type: application/json" -d '{"ethAddress":"0x173Fdf2C4845D61dB0CB93B789154475aff30729","amount":1000}' http://localhost:3000/api/v1/mint
{
  "success": true,
  "transactionHash": "0x480eb9c7093f528c2fcd1c481e3dc90962c90fc5a2f2b28177ed1a21d72b3cf5"
}
```

### Look up ERC20 balances

Query the ERC20 balances for an Ethereum account.

```console
$ curl -H "Content-Type: application/json" http://localhost:3000/api/v1/accounts/0x173Fdf2C4845D61dB0CB93B789154475aff30729/balance
{
  "balance": "1000"
}
```

### Deposit Zether

Call the following endpoint to deposit ERC20 tokens to Zether and get the corresponding shielded account funded with the equal amount of zether tokens.

```console
$ curl -H "Content-Type: application/json" -d '{"ethAddress":"0x173Fdf2C4845D61dB0CB93B789154475aff30729","amount":100}' http://localhost:3000/api/v1/fund
{
  "success": true,
  "transactionHash": "0x480eb9c7093f528c2fcd1c481e3dc90962c90fc5a2f2b28177ed1a21d72b3cf5"
}
```

### Lookup zether balances

Query the zether balances for a shielded account.

```console
$ curl -H "Content-Type: application/json" http://localhost:3000/api/v1/accounts/0x088e0c151ce3828ac25245a6fd56977f986ae3bb3724651b4bf7b49ed45f1269,0x083c23057e981fc55494300414be6ddb4b42f9c6a4c8e6f989cf9419c2cff3c8/balance
{
  "balance": 100
}
```

### Transfer Zether

Transfer zether between shielded accounts.

```console
$ curl -H "Content-Type: application/json" -d '{"sender":"0x088e0c151ce3828ac25245a6fd56977f986ae3bb3724651b4bf7b49ed45f1269,0x083c23057e981fc55494300414be6ddb4b42f9c6a4c8e6f989cf9419c2cff3c8","receiver":"0x21c7312f9589a25e6ba90371046e95e511ae4ac71f1d75ebd32e0cb11454fee7,0x05607ed8af5a53bc9cf1955a377bb229e6d2a10e7a35e2a381021e641231d4b2","amount":10}' http://localhost:3000/api/v1/transfer
{
  "success": true,
  "transactionHash": "0x480eb9c7093f528c2fcd1c481e3dc90962c90fc5a2f2b28177ed1a21d72b3cf5"
}
```

### Withdraw Zether

Burn the zether tokens and get back equal amount in ERC20 tokens. This call burns the zether amount from the shielded account corresponding to the specified Ethereum account, and release equal amount of ERC20 tokens to the Ethereum account (which was being held by the Zether contract).

```console
$ curl -H "Content-Type: application/json" -d '{"ethAddress":"0x173Fdf2C4845D61dB0CB93B789154475aff30729","amount":10}' http://localhost:3000/api/v1/withdraw
{
  "success": true,
  "transactionHash": "0x480eb9c7093f528c2fcd1c481e3dc90962c90fc5a2f2b28177ed1a21d72b3cf5"
}
```

# Run Unit Tests

Make sure to delete the file `.env` from the root of the project, if you have created it. Otherwise it will interface with the tests and cause some tests to fail.

## Launch An Ethereum blockchain

There are tests that interacts with a live Ethereum blockchain. The easiest way to have such a test chain is by running a hardhat node. Refer to the instructions in the [Blockchain network](#blockchain-network) section.

## Deploy Contracts

The easiest way to deploy the Anonymous Zether contracts is by using the hardhat scripts as described in the [Deploy contracts](#deploy-contracts) section.

## Add test configurations

Add the following environment variables used by the tests, using the addresses of the `CashToken` and `ZSC` contracts resulted from the deployment above:

```console
export ERC20_ADDRESS_TEST=0x9C62Ce07E53FC2fE1C3fd834CD5B762f39c85440
export ZSC_ADDRESS_TEST=0x0C27D112B6E02BC662EeD8eF577449Effc04DFc5
```

## Run Tests

Then you can launch the test suite:

```console
npm test
```
