#!/usr/bin/env node
'use strict';

// THE SOLVER, BUNDLED INTO THE PLUGIN, FROM ONE SOURCE.
//
// solver/ is where the layout engine is written, read and tested: plain
// modules, runnable in node, checked by solver/cases.js in a few seconds.
// The plugin needs the same code as one inline <script>, because the server
// takes a fixed set of files and a device does not fetch modules.
//
// So the bundle is GENERATED and committed inside shared.liquid, between two
// markers, and ./test.sh checks it is current. Two copies of a thing is how
// the engine this replaces came to have five different opinions about where
// a caption goes; one copy and a check is how this one keeps having one.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// WHAT THE PANEL ACTUALLY NEEDS, and nothing else.
//
// `render.js` is NOT here. It draws a board as a standalone SVG document for
// `shot.js` and the ascii pictures, which is a thing node does and the device
// never asks for -- and carrying it cost more than its bytes. It emits a
// stylesheet with the picture, and it spells the tags in halves (`'<sty' +
// 'le>'`) so the template carrying the script does not read as opening one.
// The minifier CONSTANT-FOLDS that back into a literal `</style>`, squeeze.py
// then cuts the template's real stylesheet out at the script's copy of it,
// and what reached the device was a script sliced in half. A deploy caught
// it; nothing before the deploy could have.
const ORDER = ['board', 'rails', 'captions', 'order', 'bands', 'day',
               'measure-dom', 'fit', 'draw'];
const START = '/* ---- solver bundle: generated from solver/ by plugin/bundle.js ---- */';
const END = '/* ---- end solver bundle ---- */';

function build() {
  const parts = [START,
    '// Do not edit here. Edit solver/*.js and run `node plugin/bundle.js`.',
    'var SOLVER = (function () {',
    '  var MODS = {};',
    '  function require(n) { return MODS[n.replace(/^\\.\\//, "")]; }'];
  for (const m of ORDER) {
    const src = fs.readFileSync(path.join(ROOT, 'solver', m + '.js'), 'utf-8')
      .replace(/^'use strict';\n/, '');
    parts.push('  MODS["' + m + '"] = (function () {');
    parts.push('    var module = { exports: {} }; var exports = module.exports;');
    parts.push(src);
    parts.push('    return module.exports;');
    parts.push('  })();');
  }
  parts.push('  return MODS;');
  parts.push('})();');
  parts.push(END);
  return parts.join('\n');
}

function splice(liquid, bundle) {
  const i = liquid.indexOf(START);
  const j = liquid.indexOf(END);
  if (i < 0 || j < 0) throw new Error('shared.liquid has no solver bundle markers');
  return liquid.slice(0, i) + bundle + liquid.slice(j + END.length);
}

if (require.main === module) {
  const check = process.argv.indexOf('--check') >= 0;
  const p = path.join(ROOT, 'plugin', 'src', 'shared.liquid');
  const was = fs.readFileSync(p, 'utf-8');
  const now = splice(was, build());
  if (was === now) { console.log('solver bundle is current'); process.exit(0); }
  if (check) {
    console.error('shared.liquid is out of date with solver/; run: node plugin/bundle.js');
    process.exit(1);
  }
  fs.writeFileSync(p, now);
  console.log('bundled ' + ORDER.length + ' module(s) into shared.liquid');
}

module.exports = { build, splice, START, END, ORDER };
