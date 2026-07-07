const express = require('express');

const { normalizeMac, fromHexHyp } = require('../services/mac');
const { renderBootScript, renderUnknownScript } = require('../services/ipxeTemplate');
const {
  getClientByMac,
  updateClient,
  getAllSettings,
  upsertDiscovered,
  logEvent,
} = require('../db/index');

// Every response is 200 text/plain, even for malformed MACs, unknown clients, or
// internal errors: booting iPXE firmware has no login flow and cannot handle an
// HTTP error status, so we always hand it an executable script instead of stranding it.
function ipxe(res, body) {
  res.set('Content-Type', 'text/plain');
  res.status(200).send(body);
}

function createBootRouter(ctx) {
  const router = express.Router();

  router.get('/boot/:macfile', (req, res) => {
    try {
      const hexhyp = req.params.macfile.replace(/\.ipxe$/i, '');

      let mac;
      try {
        mac = normalizeMac(fromHexHyp(hexhyp));
      } catch (e) {
        return ipxe(res, '#!ipxe\necho Malformed MAC in request path\nshell\n');
      }

      const client = getClientByMac(ctx.db, mac);

      let script;
      if (client) {
        const settings = getAllSettings(ctx.db);
        script = renderBootScript({ client, settings, truenasHost: ctx.config.truenasHost });

        if (client.boot_golden_once) {
          updateClient(ctx.db, client.id, { boot_golden_once: 0 });
        }
        updateClient(ctx.db, client.id, { last_boot_at: new Date().toISOString() });
        logEvent(ctx.db, {
          action: 'boot.serve',
          clientId: client.id,
          after: { target: client.target_name },
        });
      } else {
        upsertDiscovered(ctx.db, mac);
        logEvent(ctx.db, { action: 'boot.serve.unknown', after: { mac } });
        script = renderUnknownScript(mac);
      }

      return ipxe(res, script);
    } catch (err) {
      console.error('boot route error:', err);
      return ipxe(res, '#!ipxe\necho FleetDeck internal error\nshell\n');
    }
  });

  return router;
}

module.exports = { createBootRouter };
