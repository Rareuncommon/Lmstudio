'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');

const { loadConfig } = require('./config');
const { initDb, listEvents } = require('./db');
const { TrueNASClient } = require('./truenas/client');
const { TrueNASAdapter } = require('./truenas/adapter');
const { requireAuth } = require('./middleware/requireAuth');
const { createAuthRouter } = require('./routes/auth');
const { createClientsRouter } = require('./routes/clients');
const { createGoldenRouter } = require('./routes/golden');
const { createSettingsRouter } = require('./routes/settings');
const { createBootRouter } = require('./routes/boot');
const { startSessionPoller } = require('./services/sessionPoller');
const { startScheduler } = require('./services/scheduler');

// client.connect() has no internal timeout, so an unreachable/slow TrueNAS box
// would otherwise hang server startup indefinitely instead of degrading gracefully.
const CONNECT_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

async function connectTrueNAS(config) {
  const client = new TrueNASClient({ url: config.truenasUrl, apiKey: config.truenasApiKey });
  try {
    await withTimeout(
      client.connect(),
      CONNECT_TIMEOUT_MS,
      `TrueNAS connect() timed out after ${CONNECT_TIMEOUT_MS}ms`
    );
    const adapter = new TrueNASAdapter(client);
    await withTimeout(
      adapter.introspect(),
      CONNECT_TIMEOUT_MS,
      `TrueNAS introspect() timed out after ${CONNECT_TIMEOUT_MS}ms`
    );
    return { client, adapter };
  } catch (err) {
    // Don't leave a half-open socket retrying in the background after we've
    // given up and decided to run without an adapter.
    try { await client.close(); } catch (_) { /* already closed/closing */ }
    throw err;
  }
}

async function main() {
  const config = loadConfig();
  const db = initDb(config.dbPath);

  let truenasClient = null;
  let adapter = null;
  try {
    const connected = await connectTrueNAS(config);
    truenasClient = connected.client;
    adapter = connected.adapter;
    console.log('[server] connected to TrueNAS and resolved RPC methods');
  } catch (err) {
    console.error(
      `[server] TrueNAS connection failed, continuing with adapter unavailable: ${err.message}`
    );
    console.error('[server] routes that depend on TrueNAS will respond 500 until this is resolved');
  }

  const ctx = { db, adapter, config };

  const app = express();
  app.use(express.json());

  // Unauthenticated: booting firmware cannot do a login flow.
  app.use(createBootRouter(ctx));

  // Also unauthenticated: you can't require a session cookie to obtain one.
  app.use(createAuthRouter({ adminPassword: config.adminPassword, cookieSecret: config.cookieSecret }));

  // Static frontend shell is served without auth — it's just the SPA's HTML/JS/CSS.
  // The page's own JS hits the API, gets 401, and shows its login form. `app.use`
  // with no path prefix matches every request, so `auth` must be scoped to /api
  // below rather than applied here, or it would also block this static handler.
  app.use(express.static(path.join(__dirname, 'public')));

  const auth = requireAuth(config.cookieSecret);
  app.use('/api', auth);
  app.use(createClientsRouter(ctx));
  app.use(createGoldenRouter(ctx));
  app.use(createSettingsRouter(ctx));

  app.get('/api/events', (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
      return res.status(200).json(listEvents(db, { limit }));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  const stopPoller = startSessionPoller(ctx);
  const stopScheduler = startScheduler(ctx);

  const server = app.listen(config.httpPort, config.httpBind, () => {
    console.log(
      `[server] FleetDeck listening on ${config.httpBind}:${config.httpPort} ` +
        `(DRY_RUN=${config.dryRun ? '1' : '0'}, truenas=${adapter ? 'connected' : 'unavailable'})`
    );
  });

  const shutdown = async (signal) => {
    console.log(`[server] received ${signal}, shutting down`);
    stopPoller();
    stopScheduler();
    server.close();
    if (truenasClient) {
      try {
        await truenasClient.close();
      } catch (_) {
        // already closing/closed
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] fatal startup error:', err);
  process.exit(1);
});
