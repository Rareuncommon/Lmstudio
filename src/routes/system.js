'use strict';

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const pkg = require('../../package.json');
const { listClients, listPoolHistory, logEvent } = require('../db');

// Tables a restore copies, in dependency order. Older backups may lack the
// newer tables (initDb migrations recreate them empty) — only CORE_TABLES
// are required for a backup to be considered compatible at all.
const RESTORE_TABLES = [
  'clients', 'settings', 'events', 'discovered', 'safety_snapshots',
  'golden_build_sessions', 'sessions', 'discovered_hardware_gaps',
  'maintenance_windows', 'admins', 'pool_history',
];
const CORE_TABLES = ['clients', 'settings', 'events'];
const RESTORE_CONFIRM_PHRASE = 'RESTORE FLEETDECK';

function createSystemRouter(ctx) {
  const router = express.Router();

  // ---- unauthenticated monitoring endpoints -------------------------------
  // Deliberately minimal: external monitors can't log in, and neither route
  // exposes anything beyond coarse fleet counts and connection state — same
  // reasoning as /status (see routes/guest.js).

  router.get('/healthz', (req, res) => {
    return res.status(200).json({
      ok: true,
      truenas: ctx.adapter ? 'connected' : 'disconnected',
      dryRun: !!ctx.config.dryRun,
    });
  });

  router.get('/metrics', (req, res) => {
    try {
      // Hand-rolled Prometheus exposition — five gauges don't justify a
      // metrics library dependency.
      const clients = listClients(ctx.db);
      const booted = clients.filter((c) => c.status === 'booted').length;
      const pool = ctx.poolMonitor && ctx.poolMonitor.getStatus();
      const lines = [
        '# HELP fleetdeck_clients_total Registered clients',
        '# TYPE fleetdeck_clients_total gauge',
        `fleetdeck_clients_total ${clients.length}`,
        '# HELP fleetdeck_clients_booted Clients with an active iSCSI session',
        '# TYPE fleetdeck_clients_booted gauge',
        `fleetdeck_clients_booted ${booted}`,
        '# HELP fleetdeck_truenas_connected 1 when the TrueNAS RPC connection is up',
        '# TYPE fleetdeck_truenas_connected gauge',
        `fleetdeck_truenas_connected ${ctx.adapter ? 1 : 0}`,
        '# HELP fleetdeck_dry_run 1 when DRY_RUN is armed (mutations disabled)',
        '# TYPE fleetdeck_dry_run gauge',
        `fleetdeck_dry_run ${ctx.config.dryRun ? 1 : 0}`,
      ];
      if (pool && pool.usedPercent != null) {
        lines.push(
          '# HELP fleetdeck_pool_used_percent Pool capacity used',
          '# TYPE fleetdeck_pool_used_percent gauge',
          `fleetdeck_pool_used_percent ${pool.usedPercent.toFixed(2)}`
        );
      }
      res.set('Content-Type', 'text/plain; version=0.0.4');
      return res.status(200).send(lines.join('\n') + '\n');
    } catch (err) {
      return res.status(500).send(`# metrics error: ${err.message}\n`);
    }
  });

  // ---- authenticated system API -------------------------------------------

  router.get('/api/system/info', (req, res) => {
    return res.status(200).json({
      version: pkg.version,
      dryRun: !!ctx.config.dryRun,
      truenasConnected: !!ctx.adapter,
      update: ctx.updateInfo || null,
      // Baked in by the Docker build (--build-arg); absent in local dev.
      gitCommit: process.env.GIT_COMMIT || null,
      buildDate: process.env.BUILD_DATE || null,
      adminUser: req.adminUser || null,
    });
  });

  router.get('/api/pool/history', (req, res) => {
    try {
      return res.status(200).json(listPoolHistory(ctx.db));
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Backup: VACUUM INTO writes a consistent, compacted copy — never stream
  // the live WAL-mode file (a torn read is a corrupt backup).
  router.post('/api/backup', (req, res) => {
    const tmp = path.join(os.tmpdir(), `fleetdeck-backup-${Date.now()}.sqlite3`);
    try {
      ctx.db.prepare('VACUUM INTO ?').run(tmp);
      logEvent(ctx.db, { action: 'system.backup', actor: req.adminUser || 'system' });
      return res.download(tmp, `fleetdeck-backup-${new Date().toISOString().slice(0, 10)}.sqlite3`, () => {
        fs.unlink(tmp, () => {});
      });
    } catch (err) {
      fs.unlink(tmp, () => {});
      return res.status(500).json({ error: err.message });
    }
  });

  // Restore: validate the upload is a compatible FleetDeck database, then —
  // inside one transaction on the LIVE connection — wipe and re-copy every
  // known table from the attached upload. Copying via ATTACH keeps ctx.db
  // valid everywhere (routes/services/pollers hold the same handle), which a
  // file swap could not do without a process restart. Destructive enough to
  // demand a typed confirmation phrase.
  router.post('/api/restore',
    express.raw({ type: '*/*', limit: '256mb' }),
    (req, res) => {
      const tmp = path.join(os.tmpdir(), `fleetdeck-restore-${Date.now()}.sqlite3`);
      try {
        if ((req.query.confirm || '') !== RESTORE_CONFIRM_PHRASE) {
          return res.status(400).json({
            error: `Refusing restore without confirm=${RESTORE_CONFIRM_PHRASE} — a bad restore destroys the current state`,
          });
        }
        if (!Buffer.isBuffer(req.body) || req.body.length < 512) {
          return res.status(400).json({ error: 'Upload is not a SQLite database' });
        }
        // SQLite magic: "SQLite format 3\0".
        if (!req.body.subarray(0, 15).equals(Buffer.from('SQLite format 3'))) {
          return res.status(400).json({ error: 'Upload is not a SQLite database (bad magic)' });
        }
        fs.writeFileSync(tmp, req.body);

        // Validate schema compatibility read-only before touching anything.
        const probe = new Database(tmp, { readonly: true });
        try {
          const tables = new Set(
            probe.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
          );
          const missing = CORE_TABLES.filter((t) => !tables.has(t));
          if (missing.length > 0) {
            return res.status(400).json({ error: `Not a FleetDeck backup: missing table(s) ${missing.join(', ')}` });
          }
        } finally {
          probe.close();
        }

        const present = (t) => {
          const row = ctx.db.prepare(
            "SELECT name FROM restore_src.sqlite_master WHERE type='table' AND name = ?"
          ).get(t);
          return !!row;
        };

        ctx.db.exec(`ATTACH DATABASE '${tmp.replace(/'/g, "''")}' AS restore_src`);
        try {
          ctx.db.exec('PRAGMA defer_foreign_keys = ON');
          const tx = ctx.db.transaction(() => {
            for (const t of RESTORE_TABLES) {
              if (!present(t)) continue; // older backup without this table
              // Column intersection: a backup from an older schema simply
              // leaves newer columns at their defaults.
              const liveCols = ctx.db.pragma(`table_info(${t})`).map((c) => c.name);
              const srcCols = ctx.db.prepare(`SELECT * FROM restore_src.${t} LIMIT 0`).columns().map((c) => c.name);
              const cols = liveCols.filter((c) => srcCols.includes(c));
              if (cols.length === 0) continue;
              ctx.db.prepare(`DELETE FROM ${t}`).run();
              ctx.db.prepare(
                `INSERT INTO ${t} (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM restore_src.${t}`
              ).run();
            }
          });
          tx();
        } finally {
          ctx.db.exec('DETACH DATABASE restore_src');
        }
        logEvent(ctx.db, { action: 'system.restore', actor: req.adminUser || 'system', after: { bytes: req.body.length } });
        return res.status(200).json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      } finally {
        fs.unlink(tmp, () => {});
      }
    });

  return router;
}

module.exports = { createSystemRouter, RESTORE_CONFIRM_PHRASE };
