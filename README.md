# Overview

A client implementation for [anonymous-zether](https://github.com/Consensys/anonymous-zether) with a REST interface.

# Dependency

anonymous-zether is not published as an NPM module, so you must check out the repository to fulfill the dependency.

Checkout the repository [anonymous-zether](https://github.com/Consensys/anonymous-zether) so that it's peer to the root of this repository.

Then you can `npm i` or `yarn` to install the dependencies.

# Launch

First make sure the smart contracts are deployed properly. To make Zether work, you need an ERC20 and Zether deployed, plus their dependencies.

The easiest way to deploy is using the truffle migration script found in the project anonymous-zether in the `packages/protocol` folder.

## Configurations

The app takes configurations in the form of environment variables. They can be provided separately or via the `.env` file in the same folder as the `app.js`. A sample copy has been provided so you just need to update the values according to your blockchain environment.

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
