#!/usr/bin/env node
'use strict';

// EVERY KIND OF BOARD ON ONE SHEET, so a change can be looked at rather than
// argued about.
//
// The suites prove a board is well formed. They do not show you it, and almost
// every fault this project has shipped was found by somebody looking at a
// picture: a caption written across another one, a grey wash behind a corridor,
// a name touching nothing, a ghost rail beside a tube. Each of those cost a
// round trip -- render one board, crop it, send it, wait. This renders the lot
// and tiles them, captioned, in one image.
//
// Usage:
//   node tools/sheet.js                        every scenario, og-landscape
//   node tools/sheet.js --view x-landscape     at a device's real size
//   node tools/sheet.js --only shared,corridor pick scenarios by substring
//   node tools/sheet.js --out /tmp/sheet.png   where to write it
//
// It builds the plugin first unless --no-build, because a stale _build is a
// sheet of yesterday's boards, which is worse than no sheet at all. A layout
// run and a build must not happen at the same time (AGENTS.md), so do not run
// this beside the suite.

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'test/layout/.cache');
const CHROME = process.env.METRO_CHROME
  || '/home/dev/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const CSS_URL = 'https://trmnl.com/css/3.3.1/plugins.css';
const JS_URL = 'https://trmnl.com/js/3.3.1/plugins.js';

// The device each view is really drawn on. Getting these wrong renders one
// panel's board at another panel's size and every conclusion from it is
// worthless, so they are the layout suite's own table, copied deliberately.
const VIEWPORTS = {
  'og-landscape': { w: 800, h: 480, page: 'full',
    classes: 'screen--og screen--md screen--1bit screen--density-1x' },
  'x-landscape': { w: 1872, h: 1404, page: 'full',
    classes: 'screen--v2 screen--lg screen--4bit screen--density-2x' },
  'x-portrait': { w: 1404, h: 1872, page: 'full',
    classes: 'screen--v2 screen--lg screen--4bit screen--density-2x screen--portrait' },
  'og-half': { w: 800, h: 480, page: 'full', slot: { w: 400, h: 480 },
    classes: 'screen--og screen--md screen--1bit screen--density-1x' },
};

// ---------------------------------------------------------------- the payloads

// THE DEMO DAYS AT THE HOURS THAT CHANGE THE BOARD. Morning has everything
// ahead of it, the middle of the day has a window cutting both ways, and late
// evening has most of it behind -- which is when an event already running, a
// clipped branch and a shed name all show up.
const DEMO_TIMES = ['07:30', '13:40', '21:30'];
const DEMO_SETS = ['simpsons', 'futurama', 'friends'];

function served(url) {
  const m = /\/main\/(demo\/.*|i18n\/.*)$/.exec(String(url));
  const full = m && path.join(ROOT, m[1]);
  if (full && fs.existsSync(full)) {
    const text = fs.readFileSync(full, 'utf-8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  }
  return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
}

async function demoPayload(set, hm) {
  const transform = fs.readFileSync(path.join(ROOT, 'plugin/src/transform.js'), 'utf-8');
  const [h, mi] = hm.split(':').map(Number);
  const now = Date.UTC(2026, 8, 16, h + 5, mi);   // America/Chicago in September
  class D extends Date {
    constructor(...a) { if (!a.length) super(now); else super(...a); }
    static now() { return now; }
  }
  const sb = { fetch: async (u) => served(u), console: { log() {}, warn() {}, error() {} },
               Date: D, Math, Array, Object, JSON, String, Number, Boolean, RegExp, Promise,
               Map, Set, AbortController, setTimeout, clearTimeout, URLSearchParams, Intl,
               module: { exports: {} } };
  vm.createContext(sb);
  vm.runInContext(transform + '\nmodule.exports={run};', sb);
  const r = await sb.module.exports.run({
    trmnl: { system: { timestamp_utc: Math.floor(now / 1000) },
             user: { locale: 'en-US', time_zone_iana: 'America/Chicago' },
             plugin_settings: { instance_name: 'Metro', custom_fields_values:
               { use_demo_data: 'true', demo_set: set, time_format: '12h' } } } });
  return r.data;
}

// ---------------------------------------------------------------- the page

// Lifted from test/layout/run.js's pageFor, and it has to stay lifted: this
// must render what the DEVICE renders, not a convenient approximation.
function swapMetro(html, metro) {
  const m = /window\.METRO\s*=\s*|var\s+METRO\s*=\s*/.exec(html);
  if (!m) throw new Error('no METRO literal in the built page; run trmnlp build');
  const at = m.index, open = html.indexOf('{', at + m[0].length - 1);
  let depth = 0, i = open, inStr = false, esc = false;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(0, open) + JSON.stringify(metro) + html.slice(i);
}

function pageFor(metro, vp) {
  let html = fs.readFileSync(path.join(ROOT, 'plugin/_build', vp.page + '.html'), 'utf-8');
  html = swapMetro(html, metro);
  const css = path.join(CACHE, 'plugins.local.css'), js = path.join(CACHE, 'plugins.js');
  for (const f of [css, js]) {
    if (!fs.existsSync(f)) throw new Error('missing ' + f + '; run the layout suite once to fetch the framework');
  }
  html = html.split(CSS_URL).join('file://' + css).split(JS_URL).join('file://' + js);
  const tag = /class="screen([^"]*)"/;
  if (!tag.test(html)) throw new Error('the built page has no .screen element to size');
  html = html.replace(tag, (m0, rest) => 'class="screen' + rest + ' ' + vp.classes + '"');
  if (vp.slot) {
    html = html.replace('</head>', '<style>.screen{--full-w:' + vp.slot.w + 'px !important;'
      + '--full-h:' + vp.slot.h + 'px !important}</style></head>');
  }
  return html;
}

// ---------------------------------------------------------------- arguments

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const viewName = arg('view', 'og-landscape');
const vp = VIEWPORTS[viewName];
if (!vp) {
  console.error('unknown view "' + viewName + '"; try: ' + Object.keys(VIEWPORTS).join(', '));
  process.exit(2);
}
const only = (arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const out = path.resolve(arg('out', path.join(os.tmpdir(), 'metro-sheet.png')));
const noBuild = process.argv.indexOf('--no-build') > 0;

(async () => {
  if (!noBuild) {
    process.stderr.write('building the plugin...\n');
    execFileSync('trmnlp', ['build'], { cwd: path.join(ROOT, 'plugin'), stdio: 'pipe' });
  }

  // EVERY SCENARIO THE PROJECT ALREADY NAMES. The layout fixtures are the
  // list: each one exists because some board shape needed its own name.
  const boards = [];
  for (const f of require(path.join(ROOT, 'test/layout/fixtures'))) {
    boards.push({ name: f.name, metro: f.metro });
  }
  for (const set of DEMO_SETS) {
    for (const hm of DEMO_TIMES) {
      boards.push({ name: set + ' ' + hm, demo: [set, hm] });
    }
  }
  const wanted = boards.filter((b) => !only.length || only.some((o) => b.name.indexOf(o) >= 0));
  if (!wanted.length) {
    console.error('nothing matched --only ' + only.join(','));
    process.exit(2);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-sheet-'));
  const tiles = [];
  for (const b of wanted) {
    const metro = b.demo ? await demoPayload(b.demo[0], b.demo[1]) : b.metro;
    const file = path.join(dir, b.name.replace(/[^a-z0-9]+/gi, '-') + '.html');
    const png = file.replace(/\.html$/, '.png');
    fs.writeFileSync(file, pageFor(metro, vp));
    try {
      execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
        '--force-device-scale-factor=1', '--virtual-time-budget=8000',
        '--window-size=' + vp.w + ',' + vp.h, '--screenshot=' + png, 'file://' + file],
        { stdio: 'pipe', timeout: 120000 });
    } catch (e) {
      process.stderr.write('  ' + b.name + ': chromium failed, skipped\n');
      continue;
    }
    // The caption goes ON the tile, because a sheet whose labels live in a
    // legend somewhere else is a sheet nobody can read at a glance.
    execFileSync('magick', [png, '-resize', '540x', '-bordercolor', 'white', '-border', '6',
      '-background', 'white', '-fill', 'black', '-pointsize', '17',
      'label:' + b.name, '-gravity', 'center', '-append', png], { stdio: 'pipe' });
    tiles.push(png);
    process.stderr.write('  ' + b.name + '\n');
  }

  if (!tiles.length) { console.error('nothing rendered'); process.exit(1); }
  execFileSync('montage', tiles.concat(['-tile', '3x', '-geometry', '+8+8',
    '-background', '#dddddd', out]), { stdio: 'pipe' });
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(tiles.length + ' board(s) at ' + viewName + ' -> ' + out + ' (' + kb + 'KB)');
})().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
