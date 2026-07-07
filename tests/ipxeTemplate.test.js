'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderBootScript, renderUnknownScript } = require('../src/services/ipxeTemplate');

const HOST = '10.0.0.5';

function makeClient(overrides = {}) {
  return {
    target_name: 'win-pc01',
    raw_override: null,
    boot_golden_once: 0,
    golden_snapshot: 'snap-1',
    ...overrides,
  };
}

test('default template renders with no overrides', () => {
  const script = renderBootScript({ client: makeClient(), settings: {}, truenasHost: HOST });
  assert.equal(
    script,
    '#!ipxe\nsanboot iscsi:10.0.0.5::::iqn.2005-10.org.freenas.ctl:win-pc01\n'
  );
});

test('settings.iqn_prefix overrides the default iqn', () => {
  const script = renderBootScript({
    client: makeClient(),
    settings: { iqn_prefix: 'iqn.2000-01.com.example' },
    truenasHost: HOST,
  });
  assert.match(script, /iqn\.2000-01\.com\.example:win-pc01/);
});

test('raw_override renders verbatim with token substitution', () => {
  const client = makeClient({
    raw_override: '#!ipxe\nsanboot iscsi:{{HOST}}::::{{IQN_PREFIX}}:{{TARGET}}\necho custom\n',
  });
  const script = renderBootScript({ client, settings: {}, truenasHost: HOST });
  assert.equal(
    script,
    '#!ipxe\nsanboot iscsi:10.0.0.5::::iqn.2005-10.org.freenas.ctl:win-pc01\necho custom\n'
  );
});

test('boot_golden_once sanboots win-golden instead of client target', () => {
  const script = renderBootScript({
    client: makeClient({ boot_golden_once: 1 }),
    settings: {},
    truenasHost: HOST,
  });
  assert.match(script, /:win-golden\n$/);
  assert.doesNotMatch(script, /win-pc01/);
});

test('raw_override wins over boot_golden_once', () => {
  const client = makeClient({
    boot_golden_once: 1,
    raw_override: '#!ipxe\nsanboot iscsi:{{HOST}}::::{{IQN_PREFIX}}:{{TARGET}}\n',
  });
  const script = renderBootScript({ client, settings: {}, truenasHost: HOST });
  assert.match(script, /:win-pc01\n$/);
  assert.doesNotMatch(script, /win-golden/);
});

test('global ipxe_template setting overrides the built-in default template', () => {
  const script = renderBootScript({
    client: makeClient(),
    settings: { ipxe_template: '#!ipxe\n# global\nsanboot iscsi:{{HOST}}::::{{IQN_PREFIX}}:{{TARGET}}\n' },
    truenasHost: HOST,
  });
  assert.match(script, /# global/);
  assert.match(script, /iscsi:10\.0\.0\.5::::iqn\.2005-10\.org\.freenas\.ctl:win-pc01/);
});

test('global ipxe_template still targets win-golden when boot_golden_once set', () => {
  const script = renderBootScript({
    client: makeClient({ boot_golden_once: 1 }),
    settings: { ipxe_template: '#!ipxe\nsanboot iscsi:{{HOST}}::::{{IQN_PREFIX}}:{{TARGET}}\n' },
    truenasHost: HOST,
  });
  assert.match(script, /:win-golden\n$/);
});

test('renderUnknownScript includes the MAC and ends in shell', () => {
  const mac = 'aa:bb:cc:dd:ee:ff';
  const script = renderUnknownScript(mac);
  assert.match(script, /^#!ipxe\n/);
  assert.match(script, /aa:bb:cc:dd:ee:ff/);
  assert.match(script, /discovered/);
  assert.match(script.trimEnd(), /shell$/);
});
