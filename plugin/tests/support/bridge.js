'use strict';

// A function of one of the repo's own modules, called from a spec: stdin is
// { module, fn, args }, stdout the JSON of what it returned.
const path = require('path');

let text = '';
process.stdin.on('data', (d) => { text += d; });
process.stdin.on('end', () => {
  const q = JSON.parse(text);
  const mod = require(path.join(__dirname, '..', '..', '..', q.module));
  const result = q.fn ? mod[q.fn].apply(mod, q.args || []) : mod;
  process.stdout.write(JSON.stringify({ result: result === undefined ? null : result }));
});
