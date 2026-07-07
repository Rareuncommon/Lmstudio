'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'fleetdeck_session';

function hmac(cookieSecret, data) {
  return crypto.createHmac('sha256', cookieSecret).update(data).digest('hex');
}

function signSession(cookieSecret, expiresAtMs) {
  const exp = String(expiresAtMs);
  return `${exp}.${hmac(cookieSecret, exp)}`;
}

function verifySession(cookieSecret, cookieValue) {
  if (typeof cookieValue !== 'string') return false;
  const dot = cookieValue.indexOf('.');
  if (dot <= 0) return false;
  const exp = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!/^\d+$/.test(exp) || !/^[0-9a-f]+$/i.test(sig)) return false;

  const expected = hmac(cookieSecret, exp);
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  return Number(exp) > Date.now();
}

// Express does not populate req.cookies without cookie-parser (not a dependency
// here), so we parse the raw Cookie header ourselves.
function parseCookies(req) {
  const header = req && req.headers && req.headers.cookie;
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch (_) {
      // leave value as-is if it is not valid percent-encoding
    }
    out[name] = value;
  }
  return out;
}

function requireAuth(cookieSecret) {
  return function (req, res, next) {
    const cookies = parseCookies(req);
    const value = cookies[COOKIE_NAME];
    if (value && verifySession(cookieSecret, value)) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  };
}

module.exports = { requireAuth, signSession, verifySession, parseCookies, COOKIE_NAME };
