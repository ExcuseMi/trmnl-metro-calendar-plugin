'use strict';

// THE WIDTH TABLE `metrics.js` READS, measured in the real faces.
//
// Run by hand when the framework version or the label classes change:
//   node test/boards/calibrate.js
//
// It used to build the plugin, load it from file:// in headless Chromium with
// --dump-dom, and write what it measured. The measuring now happens in the
// page TRMNL renders, through `trmnlp test` (plugin/tests/metrics_probe.js),
// and plugin/tests/metrics_spec.rb FAILS when this table and the page disagree,
// which is how a stale table was found: the OG's large face had moved by up
// to three pixels a character, and every node-side board was laid out in it.
// This runs that spec in update mode, which rewrites metrics.json.

const path = require('path');
const { execFileSync } = require('child_process');

execFileSync(path.join(__dirname, '..', '..', 'tools', 'trmnl-test'), ['--update', 'tests/metrics_spec.rb'], {
  cwd: path.join(__dirname, '..', '..'), stdio: 'inherit',
});
console.log('wrote test/boards/metrics.json');
