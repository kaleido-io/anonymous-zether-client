'use strict';

let nextRPCId = 1;
/**
 * @param {object} obj The original result object
 * @returns {object} original object enhanced with the rpc id
 */
function rpc (obj) {
  obj.id = nextRPCId++;
  obj.jsonrpc = '2.0';
  return obj;
}

module.exports = rpc;
