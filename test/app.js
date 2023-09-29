'use strict';

const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const request = require('supertest');
const fs = require('fs-extra');

const { fullSetup } = require('./lib/test-utils.js');

describe('app.js', () => {
  let server, tmpdir, epochLength, app, tm;
  let user1EthAddress, user1ShieldedAddress;
  let user2EthAddress, user2ShieldedAddress;

  before(async () => {
    // start the server
    tmpdir = fullSetup('zether-client-test');
    epochLength = parseInt(process.env.ZSC_EPOCH_LENGTH);

    const { app: expressApp, serverPromise, tradeManager } = require('../app');
    server = await serverPromise;
    app = expressApp;
    tm = tradeManager;
  });

  after(async () => {
    tm.web3.currentProvider.disconnect();
    await server.close();
    fs.removeSync(tmpdir);
  });

  it('GET /accounts: should return 200 and empty accounts', async () => {
    await request(app).get('/api/v1/accounts').expect('Content-Type', /json/).expect(200).expect([]);
  });

  it('POST /accounts: should return 200 and new account user1', async () => {
    await request(app)
      .post('/api/v1/accounts')
      .set('Content-type', 'application/json')
      .send({})
      .expect('Content-Type', /json/)
      .expect(201)
      .expect((res) => {
        expect(res.body).to.be.an('object').that.has.property('result');
        user1EthAddress = res.body.result.eth;
        user1ShieldedAddress = res.body.result.shielded;
      });
  });

  it('POST /accounts: should return 200 and new account user2', async () => {
    await request(app)
      .post('/api/v1/accounts')
      .set('Content-type', 'application/json')
      .send({})
      .expect('Content-Type', /json/)
      .expect(201)
      .expect((res) => {
        expect(res.body).to.be.an('object').that.has.property('result');
        user2EthAddress = res.body.result.eth;
        user2ShieldedAddress = res.body.result.shielded;
      });
  });

  it('POST /mint: should return 200', async () => {
    await request(app).post('/api/v1/mint').set('Content-type', 'application/json').send({ ethAddress: user1EthAddress, amount: 100 }).expect('Content-Type', /json/).expect(201).expect({});
  });

  it('POST /fund: should return 200', async () => {
    await request(app).post('/api/v1/fund').set('Content-type', 'application/json').send({ ethAddress: user1EthAddress, amount: 100 }).expect('Content-Type', /json/).expect(201).expect({});
  });

  it('POST /transfer: should return 200', async function () {
    this.timeout(3 * epochLength * 1000);
    const sender = user1ShieldedAddress.join(',');
    const receiver = user2ShieldedAddress.join(',');
    await request(app).post('/api/v1/transfer').set('Content-type', 'application/json').send({ sender, receiver, amount: 100 }).expect('Content-Type', /json/).expect(201).expect({});
  });

  it('POST /withdraw: should return 200', async function () {
    this.timeout(3 * epochLength * 1000);
    await request(app).post('/api/v1/withdraw').set('Content-type', 'application/json').send({ ethAddress: user2EthAddress, amount: 10 }).expect('Content-Type', /json/).expect(201).expect({});
  });
});
