'use strict';

const express = require('express');
const crypto = require('crypto');
const { signSession, COOKIE_NAME } = require('../middleware/requireAuth');

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  // Hash both sides so timingSafeEqual gets equal-length buffers regardless of
  // input length, avoiding a length-based early return / throw.
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function createAuthRouter({ adminPassword, cookieSecret, sessionTtlMs = 12 * 60 * 60 * 1000 }) {
  const router = express.Router();

  router.post('/api/auth/login', (req, res) => {
    const password = req.body && req.body.password;
    if (typeof password !== 'string' || !safeEqual(password, adminPassword)) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    const value = signSession(cookieSecret, Date.now() + sessionTtlMs);
    res.setHeader('Set-Cookie',
      `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}`);
    return res.status(200).json({ ok: true });
  });

  router.post('/api/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return res.status(200).json({ ok: true });
  });

  return router;
}

module.exports = { createAuthRouter };
