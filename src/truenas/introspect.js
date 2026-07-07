'use strict';

// Normalize whatever `core.get_methods` returns into a flat array of method
// name strings. TrueNAS has returned this as an object keyed by method name in
// some versions and as an array of {name} objects in others, so be defensive.
function extractMethodNames(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object') return entry.name || entry.method || null;
        return null;
      })
      .filter(Boolean);
  }
  if (typeof raw === 'object') {
    return Object.keys(raw);
  }
  return [];
}

// Given a capability name, return a substring to grep discovered methods with,
// so an unresolved capability produces a helpful "methods containing X" hint.
function hintSubstring(capability) {
  const lower = capability.toLowerCase();
  const knownParts = ['snapshot', 'dataset', 'extent', 'target', 'session'];
  for (const part of knownParts) {
    if (lower.includes(part)) return part;
  }
  return lower;
}

async function resolveMethods(client, candidates) {
  const rawMethods = await client.call('core.get_methods');
  const allMethods = extractMethodNames(rawMethods);
  const methodSet = new Set(allMethods);

  const resolved = {};
  for (const [capability, candidateNames] of Object.entries(candidates)) {
    const match = candidateNames.find((name) => methodSet.has(name));
    if (!match) {
      const substr = hintSubstring(capability);
      const containing = allMethods.filter((m) => m.toLowerCase().includes(substr));
      throw new Error(
        `No known TrueNAS method for "${capability}". Tried: ${candidateNames.join(', ')}. ` +
          `Update the candidate list in src/truenas/adapter.js. ` +
          `Methods on this server containing "${substr}": ${containing.join(', ') || '(none)'}`
      );
    }
    resolved[capability] = match;
  }
  return resolved;
}

module.exports = { resolveMethods };
