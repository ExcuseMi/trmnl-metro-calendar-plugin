'use strict';

// THE FRAMEWORK, LOCALLY, FOR THE TOOLS THAT RENDER A BOARD THEMSELVES.
//
// tools/sheet.js and test/boards/calibrate.js load a built page in headless
// Chromium from file://. They used to borrow test/layout/run.js's cache of the
// framework; the layout suite runs on `trmnlp test` now (plugin/tests), which
// loads its own, so the part they need moved here.
//
// The framework stylesheet is ~18MB and decides every text metric, so a board
// can only be measured honestly with the real thing. And it asks for its
// fonts by ABSOLUTE PATH: url("/fonts/TRMNL16-Regular.woff2"), which under
// file:// resolves to file:///fonts/... and silently fails, so every text
// metric came from whatever Chromium fell back to. The faces are fetched from
// the same host and version as the CSS, and a local copy of the CSS is written
// with the paths pointing at them.
//
// Cached in tools/.cache (git-ignored).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(__dirname, '.cache');
const CSS_URL = 'https://trmnl.com/css/3.3.1/plugins.css';
const JS_URL = 'https://trmnl.com/js/3.3.1/plugins.js';

function fetchTo(file, url) {
  if (fs.existsSync(file) && fs.statSync(file).size > 100) return;
  try {
    execFileSync('curl', ['-fsSL', '-o', file, url], { stdio: 'pipe', timeout: 120000 });
  } catch (e) {
    try { fs.unlinkSync(file); } catch (e2) { /* nothing written */ }
    throw new Error('could not fetch ' + url + ' into ' + CACHE + ': ' + e.message);
  }
}

// { css, js }: local paths of the stylesheet (fonts rewritten to local files)
// and the framework script.
function frameworkAssets() {
  fs.mkdirSync(CACHE, { recursive: true });
  const css = path.join(CACHE, 'plugins.css');
  const js = path.join(CACHE, 'plugins.js');
  fetchTo(css, CSS_URL);
  fetchTo(js, JS_URL);
  const raw = fs.readFileSync(css, 'utf-8');
  const fontDir = path.join(CACHE, 'fonts');
  fs.mkdirSync(fontDir, { recursive: true });
  const origin = CSS_URL.slice(0, CSS_URL.indexOf('/', 8));
  for (const name of new Set((raw.match(/url\("\/fonts\/[^"]+"\)/g) || []).map((u) => u.slice(6, -2)))) {
    try { fetchTo(path.join(fontDir, path.basename(name)), origin + '/fonts/' + path.basename(name)); } catch (e) {
      // A face that will not download is worth saying out loud rather than
      // silently measuring in a fallback.
      console.error('could not fetch ' + name + ': text will be measured in a fallback face');
    }
  }
  const local = path.join(CACHE, 'plugins.local.css');
  const stamp = crypto.createHash('sha1').update(raw.length + '|' + fontDir).digest('hex');
  let current = '';
  try { current = fs.readFileSync(local + '.stamp', 'utf-8'); } catch (e) { /* not written yet */ }
  if (current !== stamp || !fs.existsSync(local)) {
    fs.writeFileSync(local, raw.split('url("/fonts/').join('url("file://' + fontDir + '/'));
    fs.writeFileSync(local + '.stamp', stamp);
  }
  return { css: local, js };
}

// The built page of one view (`trmnlp build`), made in a COPY of plugin/ so a
// build can never write into the working tree or race another one (see
// AGENTS.md on .trmnlp.yml being patched in place).
function builtPage(view) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-build-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    const src = path.join(ROOT, 'plugin', 'src');
    for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dir, 'src', f));
    fs.copyFileSync(path.join(ROOT, 'plugin', '.trmnlp.yml'), path.join(dir, '.trmnlp.yml'));
    execFileSync('trmnlp', ['build'], { cwd: dir, stdio: 'pipe', timeout: 120000 });
    return fs.readFileSync(path.join(dir, '_build', (view || 'full') + '.html'), 'utf-8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { frameworkAssets, builtPage, CACHE, CSS_URL, JS_URL };
