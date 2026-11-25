'use strict';
// Runs the original DealSheet Lab calculator test suite (48 hand-checked cases) against the ported engine.
const { test } = require('node:test'); const assert = require('node:assert/strict'); const { execFileSync } = require('child_process'); const path = require('path');
test('ported calc.js + memo.js pass the DealSheet Lab hand-worked cases', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'legacy_calc_check.js')], { encoding: 'utf8' });
  assert.match(out, /\n(\d+) passed, 0 failed/); console.log(out.trim().split('\n').pop());
});
