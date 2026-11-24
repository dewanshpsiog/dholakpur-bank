import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPaise } from './amount.js';

test('converts whole and fractional rupees to paise', () => {
  assert.equal(toPaise('12'), 1200);
  assert.equal(toPaise('12.3'), 1230);
  assert.equal(toPaise(' 0.01 '), 1);
});

test('rejects zero, malformed values, and precision beyond paise', () => {
  for (const input of ['0', '0.00', '-1', '1.001', '1,000', 'abc']) {
    assert.equal(toPaise(input), null, `expected ${input} to be rejected`);
  }
});

test('rejects amounts whose paise value is not a safe integer', () => {
  assert.equal(toPaise('90071992547409.92'), null);
});
