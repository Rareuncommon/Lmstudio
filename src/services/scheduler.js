const cron = require('node-cron');
const { listClients, getSetting, logEvent } = require('../db');
const { resetClient } = require('./clientOps');

const DEFAULT_CRON = '0 4 * * *';

async function runNightlyReset(ctx) {
  // Re-read the opted-in client list fresh on every fire (don't cache at startup).
  const clients = listClients(ctx.db).filter((c) => c.nightly_reset === 1);
  let failures = 0;

  // Sequential (not parallel) to avoid concurrent zvol destroy/clone calls on TrueNAS.
  for (const client of clients) {
    try {
      await resetClient(ctx, client.id, { force: true });
    } catch (err) {
      failures += 1;
      console.error(`[scheduler] reset failed for client ${client.id} (${client.name}):`, err);
      logEvent(ctx.db, {
        action: 'scheduler.reset.failed',
        clientId: client.id,
        after: { error: err && err.message ? err.message : String(err) },
      });
    }
  }

  logEvent(ctx.db, {
    action: 'scheduler.nightly_reset',
    after: { count: clients.length, failures },
  });
}

function startScheduler(ctx) {
  let cronExpr = getSetting(ctx.db, 'nightly_reset_cron', DEFAULT_CRON);

  if (!cron.validate(cronExpr)) {
    console.error(`[scheduler] invalid cron "${cronExpr}", falling back to "${DEFAULT_CRON}"`);
    cronExpr = DEFAULT_CRON;
  }

  const task = cron.schedule(cronExpr, () => {
    runNightlyReset(ctx).catch((err) => {
      console.error('[scheduler] nightly reset run crashed:', err);
    });
  });

  return function stop() {
    task.stop();
  };
}

module.exports = { startScheduler };
