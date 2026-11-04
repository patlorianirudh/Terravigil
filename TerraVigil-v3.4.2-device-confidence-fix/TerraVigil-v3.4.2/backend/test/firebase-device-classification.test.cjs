'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classification } = require('../reports/snapshot');

test('Firebase camera observations are visual candidates and metal observations stay in the metal category', () => {
  assert.equal(classification({ status: 'UNCONFIRMED', device: 'camera' }), 'unconfirmed_visual');
  assert.equal(classification({ status: 'UNCONFIRMED', device: 'metal' }), 'unresolved_metal');
  assert.equal(classification({ status: 'UNCONFIRMED', confirmation_source: 'metal_sensor_only' }), 'unresolved_metal');
  assert.equal(classification({ status: 'UNCONFIRMED' }), 'unconfirmed_visual');
});
