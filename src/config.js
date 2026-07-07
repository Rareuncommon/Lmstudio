'use strict';

function truthyFlag(v, defaultValue) {
  if (v === undefined || v === '') return defaultValue;
  return v === '1' || v.toLowerCase() === 'true';
}

function deriveTruenasHost(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch (_) {
    return null;
  }
}

function loadConfig(env = process.env) {
  const truenasUrl = env.TRUENAS_URL || 'wss://192.168.1.36:8444/websocket';
  return {
    truenasUrl,
    truenasApiKey: env.TRUENAS_API_KEY || '',
    truenasHost: deriveTruenasHost(truenasUrl),
    adminPassword: env.ADMIN_PASSWORD || '',
    cookieSecret: env.COOKIE_SECRET || '',
    httpPort: Number(env.HTTP_PORT) || 8080,
    httpBind: env.HTTP_BIND || '0.0.0.0',
    dryRun: truthyFlag(env.DRY_RUN, true),
    dbPath: env.DB_PATH || './data/fleetdeck.sqlite3',
    iqnPrefix: env.IQN_PREFIX || 'iqn.2005-10.org.freenas.ctl',
    goldenZvol: env.GOLDEN_ZVOL || 'Main_pool/iscsi/win-golden',
    clientZvolRoot: env.CLIENT_ZVOL_ROOT || 'Main_pool/iscsi',
  };
}

module.exports = { loadConfig };
