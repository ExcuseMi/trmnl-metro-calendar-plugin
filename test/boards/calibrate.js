'use strict';

// THE WIDTH TABLE `metrics.js` READS, measured in the real faces.
//
// Run by hand when the framework version or the label classes change:
//   node test/boards/calibrate.js
//
// It used to build the plugin, load it from file:// in headless Chromium with
// --dump-dom, and write what it measured. The measuring now happens in the
// page TRMNL renders, through trmnlp-test (test/trmnl/lib/metrics-probe.js),
// and test/trmnl/metrics.spec.js FAILS when this table and the page disagree,
// which is how a stale table was found: the OG's large face had moved by up
// to three pixels a character, and every node-side board was laid out in it.
// This runs that spec in update mode, which rewrites metrics.json.

const path = require('path');
const { execFileSync } = require('child_process');

execFileSync('trmnlp-test', ['run', 'metrics', '-u'], {
  cwd: path.join(__dirname, '..', '..'), stdio: 'inherit',
  env: Object.assign({}, process.env, { TRMNLP_TEST_WORKERS: process.env.TRMNLP_TEST_WORKERS || '2' }),
});
console.log('wrote test/boards/metrics.json');
