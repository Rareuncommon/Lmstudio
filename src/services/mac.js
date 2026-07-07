'use strict';

function normalizeMac(input) {
  if (typeof input !== 'string') {
    throw new Error(`Invalid MAC address: expected string, got ${typeof input}`);
  }
  const stripped = input.trim().replace(/[:\-]/g, '');
  if (!/^[0-9a-fA-F]{12}$/.test(stripped)) {
    throw new Error(`Invalid MAC address: "${input}"`);
  }
  const lower = stripped.toLowerCase();
  return lower.match(/.{2}/g).join(':');
}

function toHexHyp(mac) {
  return normalizeMac(mac).replace(/:/g, '-');
}

function fromHexHyp(hexhyp) {
  return normalizeMac(hexhyp);
}

module.exports = { normalizeMac, toHexHyp, fromHexHyp };
