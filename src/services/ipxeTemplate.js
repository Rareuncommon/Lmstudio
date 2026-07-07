'use strict';

const DEFAULT_IQN_PREFIX = 'iqn.2005-10.org.freenas.ctl';
const GOLDEN_TARGET = 'win-golden';

function resolveIqnPrefix(settings) {
  const prefix = settings && settings.iqn_prefix;
  return typeof prefix === 'string' && prefix.length > 0 ? prefix : DEFAULT_IQN_PREFIX;
}

function substitute(template, { target, host, iqnPrefix }) {
  return template
    .replace(/\{\{TARGET\}\}/g, target)
    .replace(/\{\{HOST\}\}/g, host)
    .replace(/\{\{IQN_PREFIX\}\}/g, iqnPrefix);
}

function defaultScript({ target, host, iqnPrefix }) {
  return `#!ipxe\nsanboot iscsi:${host}::::${iqnPrefix}:${target}\n`;
}

function renderBootScript({ client, settings, truenasHost }) {
  const iqnPrefix = resolveIqnPrefix(settings);
  const host = truenasHost;

  if (typeof client.raw_override === 'string' && client.raw_override.length > 0) {
    return substitute(client.raw_override, {
      target: client.target_name,
      host,
      iqnPrefix,
    });
  }

  const target = client.boot_golden_once ? GOLDEN_TARGET : client.target_name;
  const tokens = { target, host, iqnPrefix };

  if (settings && typeof settings.ipxe_template === 'string' && settings.ipxe_template.length > 0) {
    return substitute(settings.ipxe_template, tokens);
  }

  return defaultScript(tokens);
}

function renderUnknownScript(mac) {
  return [
    '#!ipxe',
    `echo Machine ${mac} is not yet registered in FleetDeck.`,
    `echo It has been logged as "discovered" for one-click adoption in the FleetDeck UI.`,
    'echo Dropping to an iPXE shell so you are not stranded.',
    'shell',
  ].join('\n') + '\n';
}

module.exports = { renderBootScript, renderUnknownScript, DEFAULT_IQN_PREFIX };
