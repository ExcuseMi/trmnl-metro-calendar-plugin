'use strict';

// Preloaded into the transform's node (NODE_OPTIONS=--require) by
// lib/transform.js, for the one part of TRMNL's transform input trmnlp-test
// cannot pass: input.trmnl.previous_merge_variables. trmnlp's wrapper reads
// the input with fs.readFileSync(0); this adds the keys from the file named in
// METRO_INJECT_INPUT to its `trmnl` before the transform sees it.

const fs = require('fs');

const file = process.env.METRO_INJECT_INPUT;
if (file) {
  const read = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) {
    const out = read.call(this, p, ...rest);
    if (p !== 0) return out;
    const input = JSON.parse(String(out));
    input.trmnl = Object.assign(input.trmnl || {}, JSON.parse(read(file, 'utf8')));
    const text = JSON.stringify(input);
    return typeof out === 'string' ? text : Buffer.from(text);
  };
}
