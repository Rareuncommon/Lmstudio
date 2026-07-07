'use strict';

const express = require('express');
const { getAllSettings, setSetting, logEvent } = require('../db');

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function createSettingsRouter(ctx) {
  const router = express.Router();
  const { db } = ctx;

  router.get('/api/settings', (req, res) => {
    try {
      return res.status(200).json(getAllSettings(db));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  router.put('/api/settings', (req, res) => {
    try {
      const body = req.body;
      if (!isPlainObject(body)) {
        return res.status(400).json({ error: 'Body must be an object of key/value pairs' });
      }
      for (const key of Object.keys(body)) {
        setSetting(db, key, String(body[key]));
      }
      logEvent(db, { action: 'settings.update', after: body });
      return res.status(200).json(getAllSettings(db));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createSettingsRouter };
