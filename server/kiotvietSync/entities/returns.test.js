'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertChildReplacement } = require('./entityTestUtils');
const entity = require('./returns');
test('returns replaces all detail rows and declares no upper bound', async () => {
  assert.equal(entity.hasUpperBound, false);
  await assertChildReplacement(entity, { Id: 12, Code: 'TH12', ReturnDetails: [{ ProductId: 2 }] }, 'return_details', 1);
});
