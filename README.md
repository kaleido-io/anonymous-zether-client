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

Checkout the repository [anonymous-zether](https://github.com/Consensys/anonymous-zether) so that it's peer to the root of this repository.

Then you can `npm i` or `yarn` to install the dependencies.

# Launch

First make sure the smart contracts are deployed properly. To make Zether work, you need an ERC20 and Zether deployed, plus their dependencies.

The easiest way to deploy is using the truffle migration script found in the project anonymous-zether in the `packages/protocol` folder.

## Configurations

The app takes configurations in the form of environment variables. They can be provided separately or via the `.env` file in the same folder as the `app.js`. A sample copy has been provided in the file `.env.sample` so you just need to copy that to file named `.env` in the same folder and update the values according to your blockchain environment.

> The existence of the `.env` file will interfere with unit tests, which relies on test instrumentation for some of the failure tests. Please make sure to delete `.env` before running the unit test suite

## Launch the server

```
node app.js
```

# API Reference

### Create a pair of ethereum and shielded accounts

The client uses a 1-1 mapping between Ethereum signing accounts and Shielded accounts.

```
$ curl -H "Content-Type: application/json" -d {} http://localhost:3000/api/v1/accounts
{
  "result": {
    "eth": "0x1A3e76010Fa50764378078aD5CfE71b271559D70",
    "shielded": [
      "0x17872c1b0dbe8f96f3909025d8628d30d479ebcacfb1fcf809f8f3a2778691d9",
      "0x071cb2add5a05a8544bc8ea1b267d9fc5330ac20b2aeb4a36a459da8ea5a6e68"
    ]
  }
}
```

### Look up hosted accounts

```
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

```
$ curl -H "Content-Type: application/json" -d '{"ethAddress":"0x173Fdf2C4845D61dB0CB93B789154475aff30729","amount":1000}' http://localhost:3000/api/v1/mint
{}
```

### Look up ERC20 balances

Query the ERC20 balances for an Ethereum account.

```
$ curl -H "Content-Type: application/json" http://localhost:3000/api/v1/accounts/0x173Fdf2C4845D61dB0CB93B789154475aff30729/balance
{
  "balance": "1000"
}
```

### Deposit Zether

Call the following endpoint to deposit ERC20 tokens to Zether and get the corresponding shielded account funded with the equal amount of zether tokens.

```
$ curl -H "Content-Type: application/json" -d '{"ethAddress":"0x173Fdf2C4845D61dB0CB93B789154475aff30729","amount":100}' http://localhost:3000/api/v1/fund
{}
```

### Lookup zether balances

Query the zether balances for a shielded account.

```
$ curl -H "Content-Type: application/json" http://localhost:3000/api/v1/accounts/0x088e0c151ce3828ac25245a6fd56977f986ae3bb3724651b4bf7b49ed45f1269,0x083c23057e981fc55494300414be6ddb4b42f9c6a4c8e6f989cf9419c2cff3c8/balance
{
  "balance": 100
}
```

### Transfer Zether

Transfer zether between shielded accounts.

```
$ curl -H "Content-Type: application/json" -d '{"sender":"0x088e0c151ce3828ac25245a6fd56977f986ae3bb3724651b4bf7b49ed45f1269,0x083c23057e981fc55494300414be6ddb4b42f9c6a4c8e6f989cf9419c2cff3c8","receiver":"0x21c7312f9589a25e6ba90371046e95e511ae4ac71f1d75ebd32e0cb11454fee7,0x05607ed8af5a53bc9cf1955a377bb229e6d2a10e7a35e2a381021e641231d4b2","amount":10}' http://localhost:3000/api/v1/transfer
{}
```

### Withdraw Zether

Burn the zether tokens and get back equal amount in ERC20 tokens. This call burns the zether amount from the shielded account corresponding to the specified Ethereum account, and release equal amount of ERC20 tokens to the Ethereum account (which was being held by the Zether contract).

```
$ curl -H "Content-Type: application/json" -d '{"ethAddress":"0x173Fdf2C4845D61dB0CB93B789154475aff30729","amount":10}' http://localhost:3000/api/v1/withdraw
{}
```

# Run Unit Tests

Make sure to delete the file `.env` from the root of the project, if you have created it. Otherwise it will interface with the tests and cause some tests to fail.

## Launch An Ethereum blockchain

There are tests that interacts with a live Ethereum blockchain. The easiest way to have such a test chain is by running [ganache-cli](https://www.npmjs.com/package/ganache-cli):

```
ganache-cli --miner.blockGasLimit 0x3b9aca00 --gasPrice 0 -k berlin -v
```

## Deploy Contracts

The easiest way to deploy the Anonymous Zether contracts is by using the truffle scripts available in the [anonymous-zether](https://github.com/Consensys/anonymous-zether) project:

```console
$ cd packages/protocol
$ truffle deploy

Compiling your contracts...
===========================
> Everything is up to date, there is nothing to compile.


Starting migrations...
======================
> Network name:    'development'
> Network id:      1695993022455
> Block gas limit: 1000000000 (0x3b9aca00)


1_initial_migration.js
======================

   Deploying 'Migrations'
   ----------------------
   > transaction hash:    0x89db3416777baadc6e31823536f2cae51548cf41ec98f09ff8962a81d651916f
   > Blocks: 0            Seconds: 0
   > contract address:    0xfd3852b12D403f4233B620503c8b17dAa5F1DE40
   > block number:        1
   > block timestamp:     1695993064
   > account:             0xD4D8362211564f9CF62b03e3c7b2A2f67D37E593
   > balance:             1000
   > gas used:            221311 (0x3607f)
   > gas price:           0 gwei
   > value sent:          0 ETH
   > total cost:          0 ETH

   > Saving migration to chain.
   > Saving artifacts
   -------------------------------------
   > Total cost:                   0 ETH


2_deploy_zsc.js
===============

   Deploying 'CashToken'
   ---------------------
   > transaction hash:    0xb62a80ed934752a33a969e9b44d8e51b87640a8145ead94de07f78af518b798a
   > Blocks: 0            Seconds: 0
   > contract address:    0x9C62Ce07E53FC2fE1C3fd834CD5B762f39c85440
   > block number:        3
   > block timestamp:     1695993064
   > account:             0xD4D8362211564f9CF62b03e3c7b2A2f67D37E593
   > balance:             1000
   > gas used:            1177501 (0x11f79d)
   > gas price:           0 gwei
   > value sent:          0 ETH
   > total cost:          0 ETH


   Deploying 'InnerProductVerifier'
   --------------------------------
   > transaction hash:    0xc11d442e73d357802d61d565a06e36633201b75267f94a304725a2b9454c04c3
   > Blocks: 0            Seconds: 0
   > contract address:    0xC8E8C170d5A52421F56Cc6d0BF8E9e0442f0C8cd
   > block number:        4
   > block timestamp:     1695993064
   > account:             0xD4D8362211564f9CF62b03e3c7b2A2f67D37E593
   > balance:             1000
   > gas used:            3774904 (0x3999b8)
   > gas price:           0 gwei
   > value sent:          0 ETH
   > total cost:          0 ETH


   Deploying 'ZetherVerifier'
   --------------------------

   Deploying 'BurnVerifier'
   ------------------------
   > transaction hash:    0xd9c6f8c9bb52a812bf72cd4f40db6203e3a27ce23b48106556c7077d8cdad2ec
   > transaction hash:    0xc072842d5b9b394c57ecadf09c2e5be38416332d2088552324d82bc5efdce1cb
   > Blocks: 0            Seconds: 0
   > contract address:    0xD762B7E04e9d979600CDcc70bC9b704C8248DB13
   > block number:        5
   > block timestamp:     1695993065
   > account:             0xD4D8362211564f9CF62b03e3c7b2A2f67D37E593
   > balance:             1000
   > gas used:            4240042 (0x40b2aa)
   > gas price:           0 gwei
   > value sent:          0 ETH
   > total cost:          0 ETH

   > Blocks: 0            Seconds: 0
   > contract address:    0x5a725aDFad590f081a2513F83e59DD844ae02aED
   > block number:        6
   > block timestamp:     1695993065
   > account:             0xD4D8362211564f9CF62b03e3c7b2A2f67D37E593
   > balance:             1000
   > gas used:            1868774 (0x1c83e6)
   > gas price:           0 gwei
   > value sent:          0 ETH
   > total cost:          0 ETH


   Deploying 'ZSC'
   ---------------
   > transaction hash:    0x6f1e29745694e0df6abfed95d06ba0264ec2ce26ef022219f90fa435b795f37e
   > Blocks: 0            Seconds: 0
   > contract address:    0x0C27D112B6E02BC662EeD8eF577449Effc04DFc5
   > block number:        7
   > block timestamp:     1695993065
   > account:             0xD4D8362211564f9CF62b03e3c7b2A2f67D37E593
   > balance:             1000
   > gas used:            2697904 (0x292ab0)
   > gas price:           0 gwei
   > value sent:          0 ETH
   > total cost:          0 ETH

   > Saving migration to chain.
   > Saving artifacts
   -------------------------------------
   > Total cost:                   0 ETH

Summary
=======
> Total deployments:   6
> Final cost:          0 ETH
```

## Add test configurations

Add the following environment variables used by the tests, using the addresses of the `CashToken` and `ZSC` contracts resulted from the deployment above:

```
export ERC20_ADDRESS_TEST=0x9C62Ce07E53FC2fE1C3fd834CD5B762f39c85440
export ZSC_ADDRESS_TEST=0x0C27D112B6E02BC662EeD8eF577449Effc04DFc5
```

## Run Tests

Then you can launch the test suite:

```
npm test
```
