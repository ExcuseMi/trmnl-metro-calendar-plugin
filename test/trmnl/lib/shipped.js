'use strict';

// THE COPY THAT SHIPS, built the way push.sh builds it.
//
// Both source files outgrew the server's 100KB per-file limit, so push.sh
// uploads copies squeezed by plugin/squeeze.py: whole-line comments out, the
// JavaScript minified, the template's engine deflated beside an inflater, the
// wrapper markup moved into the view files. A squeezer that broke the board
// would push cleanly and draw nothing on the panel, so the squeezed copy is
// tested as itself.
//
// Built here from plugin/src into test/trmnl/.shipped/<hash of the sources and
// the squeezer> (git-ignored), once per change: the build is deterministic, so
// push.sh can compare what it is about to upload with the copy this tested.
// Each worker may get here at once, so a build goes to a temp directory and is
// renamed into place.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'plugin', 'src');
const ESBUILD = path.join(ROOT, 'tools', 'node_modules', '.bin', 'esbuild');
const OUT = path.join(ROOT, 'test', 'trmnl', '.shipped');

function key() {
  const h = crypto.createHash('sha1');
  for (const f of fs.readdirSync(SRC).sort()) h.update(f + ':' + fs.readFileSync(path.join(SRC, f)).toString('binary'));
  h.update(fs.readFileSync(path.join(ROOT, 'plugin', 'squeeze.py')));
  return h.digest('hex').slice(0, 16);
}

// The squeezed plugin directory, relative to the repo root (what trmnl.plugin() takes).
function shippedPlugin() {
  const k = key();
  const dir = path.join(OUT, k);
  if (fs.existsSync(path.join(dir, 'src', 'shared.liquid'))) return path.relative(ROOT, dir);
  if (!fs.existsSync(ESBUILD)) {
    throw new Error('no esbuild in tools/node_modules: run `npm ci` in tools/ (./test.sh does)');
  }
  const tmp = dir + '.tmp-' + process.pid;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(tmp, 'src', f));
  fs.copyFileSync(path.join(ROOT, 'plugin', '.trmnlp.yml'), path.join(tmp, '.trmnlp.yml'));
  execFileSync('python3', [path.join(ROOT, 'plugin', 'squeeze.py'), path.join(tmp, 'src', 'shared.liquid'),
    path.join(tmp, 'src', 'transform.js'), ESBUILD], { stdio: 'pipe' });
  try { fs.renameSync(tmp, dir); } catch (e) {
    // another worker got there first: the build is the same
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return path.relative(ROOT, dir);
}

module.exports = { shippedPlugin, SHIPPED_DIR: OUT };
