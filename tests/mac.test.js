'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMac, toHexHyp, fromHexHyp } = require('../src/services/mac');

test('normalizeMac accepts colon form', () => {
  assert.equal(normalizeMac('aa:bb:cc:dd:ee:ff'), 'aa:bb:cc:dd:ee:ff');
});

test('normalizeMac accepts hyphen form', () => {
  assert.equal(normalizeMac('aa-bb-cc-dd-ee-ff'), 'aa:bb:cc:dd:ee:ff');
});

test('normalizeMac accepts bare form', () => {
  assert.equal(normalizeMac('aabbccddeeff'), 'aa:bb:cc:dd:ee:ff');
});

test('normalizeMac lowercases uppercase input', () => {
  assert.equal(normalizeMac('AA:BB:CC:DD:EE:FF'), 'aa:bb:cc:dd:ee:ff');
  assert.equal(normalizeMac('AABBCCDDEEFF'), 'aa:bb:cc:dd:ee:ff');
});

test('normalizeMac trims surrounding whitespace', () => {
  assert.equal(normalizeMac('  aa:bb:cc:dd:ee:ff  '), 'aa:bb:cc:dd:ee:ff');
});

test('normalizeMac rejects wrong length', () => {
  assert.throws(() => normalizeMac('aa:bb:cc:dd:ee'), /Invalid MAC address/);
  assert.throws(() => normalizeMac('aabbccddeeffaa'), /Invalid MAC address/);
});

test('normalizeMac rejects non-hex characters', () => {
  assert.throws(() => normalizeMac('gg:bb:cc:dd:ee:ff'), /Invalid MAC address/);
  assert.throws(() => normalizeMac('zzzzzzzzzzzz'), /Invalid MAC address/);
});

test('normalizeMac rejects non-string input', () => {
  assert.throws(() => normalizeMac(null), /expected string/);
  assert.throws(() => normalizeMac(123456789012), /expected string/);
});

test('toHexHyp produces hyphen form', () => {
  assert.equal(toHexHyp('aa:bb:cc:dd:ee:ff'), 'aa-bb-cc-dd-ee-ff');
});

test('fromHexHyp inverts toHexHyp', () => {
  assert.equal(fromHexHyp('aa-bb-cc-dd-ee-ff'), 'aa:bb:cc:dd:ee:ff');
});

test('fromHexHyp validates garbage via normalizeMac', () => {
  assert.throws(() => fromHexHyp('nonsense'), /Invalid MAC address/);
});

test('round-trip normalizeMac -> toHexHyp -> fromHexHyp', () => {
  const inputs = ['AA-BB-CC-DD-EE-FF', '00:11:22:33:44:55', '0a1b2c3d4e5f'];
  for (const input of inputs) {
    const normalized = normalizeMac(input);
    assert.equal(fromHexHyp(toHexHyp(normalized)), normalized);
  }
});
