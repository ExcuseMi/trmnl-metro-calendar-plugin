'use strict';

// REPORTS THAT SURVIVE THE PROCESS, shared by every worker.
//
// A board takes a few seconds to render and solve, and the cases ask for the
// same (payload, view) from many spec files, which trmnlp-test spreads over
// several workers. Each report is written to test/trmnl/.cache/reports under
// a key made of the EXACT inputs: every file of the plugin being rendered (so
// a change to shared.liquid changes every key and nothing stale can come
// back), the harness files in this directory (they decide what is measured),
// trmnlp-test's version (its Chromium, framework assets and page), and the
// payload and render options. Editing only a spec changes no key at all,
// which is the loop this is for: rewriting an expectation re-reads boards
// instead of re-rendering them.
//
// Two workers asking for the same board at once: the first takes a lock file
// and renders, the second waits for its report. In CI (no warm cache to win)
// it is off.
//
// Entries older than a week are dropped on the way in.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('trmnlp-test');

const DIR = path.join(config.root, 'test', 'trmnl', '.cache', 'reports');
const OFF = !!process.env.CI || config.metroCache === false;

let version = '';
try { version = require(path.join(path.dirname(require.resolve('trmnlp-test')), '..', 'package.json')).version; } catch (e) { /* unknown */ }

const stamps = new Map();
function hashDir(h, dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isFile()) h.update(f + ':' + fs.readFileSync(full).toString('binary') + '|');
  }
}
// What a render reads, besides the payload: the plugin's sources and this
// harness. Hashed once per process.
function stamp(pluginDir) {
  if (!stamps.has(pluginDir)) {
    const h = crypto.createHash('sha1');
    hashDir(h, path.join(pluginDir, 'src'));
    hashDir(h, __dirname);
    h.update('trmnlp-test ' + version);
    stamps.set(pluginDir, h.digest('hex'));
  }
  return stamps.get(pluginDir);
}

(function prune() {
  if (OFF) return;
  try {
    const week = Date.now() - 7 * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(DIR)) {
      const full = path.join(DIR, f);
      if (fs.statSync(full).mtimeMs < week) fs.unlinkSync(full);
    }
  } catch (e) { /* no cache yet */ }
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cached(pluginDir, inputs, produce) {
  if (OFF) return produce();
  const key = crypto.createHash('sha1').update(stamp(pluginDir) + '|' + JSON.stringify(inputs)).digest('hex');
  const file = path.join(DIR, key + '.json');
  const lock = file + '.lock';
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { return null; } };
  fs.mkdirSync(DIR, { recursive: true });
  for (let waited = 0; ; waited += 250) {
    const hit = read();
    if (hit) return hit;
    let fd = null;
    try { fd = fs.openSync(lock, 'wx'); } catch (e) {
      // somebody else is rendering it; a lock older than three minutes is
      // a worker that died holding it
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 180000) fs.unlinkSync(lock); } catch (e2) { /* gone */ }
      if (waited > 300000) return produce();
      await sleep(250);
      continue;
    }
    fs.closeSync(fd);
    try {
      const rep = await produce();
      // through a temp name: a run killed mid-write must not leave a
      // truncated report for the next one to read as a hit
      const part = file + '.' + process.pid + '.part';
      fs.writeFileSync(part, JSON.stringify(rep));
      fs.renameSync(part, file);
      return rep;
    } finally {
      try { fs.unlinkSync(lock); } catch (e) { /* gone */ }
    }
  }
}

module.exports = { cached, stamp, OFF };
