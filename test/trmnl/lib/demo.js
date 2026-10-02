'use strict';

// THE DEMO'S OWN FILES, SERVED FROM THE REPO, as trmnlp-test mocks.
//
// The demo board is a config and a set of ICS files in demo/<show>/, and the
// languages are i18n/<code>.json, all fetched at run time from this repo's
// main branch on raw.githubusercontent. A suite must not need the network,
// and what is on disk is what the next push puts on the server, so every one
// of those files is answered from disk. Anything else the transform asks for
// (the forecast, a feed nobody mocked) answers 404, as the old harnesses'
// fake fetch did.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const BASE = 'https://raw.githubusercontent.com/ExcuseMi/trmnl-metro-calendar-plugin/main/';

function walk(dir, rel, out) {
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f);
    const r = rel ? rel + '/' + f : f;
    if (fs.statSync(full).isDirectory()) walk(full, r, out);
    else out.push([r, full]);
  }
  return out;
}

// `missing` names files (relative to the repo root, e.g. 'demo/simpsons/bart.ics')
// to withhold, which is how a stale or failing feed is written.
function demoMocks({ missing = [], i18n = true } = {}) {
  const mocks = [];
  const dirs = ['demo'].concat(i18n ? ['i18n'] : []);
  for (const d of dirs) {
    for (const [rel, full] of walk(path.join(ROOT, d), d, [])) {
      if (missing.indexOf(rel) >= 0) mocks.push({ url: BASE + rel, status: 404, body: '' });
      else mocks.push({ url: BASE + rel, body: fs.readFileSync(full, 'utf-8') });
    }
  }
  return mocks;
}

// A regex mock rather than '*': mocks answer the page's own requests too, and
// the board's weather icons come from trmnl.com, which a '*' would answer with
// a 404. (The framework's files never pass through mocks.)
const NOT_FOUND = { url: '/^https?:\\/\\/(?!trmnl\\.com\\/)/', status: 404, body: '' };

module.exports = { demoMocks, NOT_FOUND, BASE, ROOT };
