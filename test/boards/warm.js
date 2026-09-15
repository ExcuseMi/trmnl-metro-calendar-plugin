'use strict';

// One worker of run.js's pool: solves the boards it is sent into the cache.
var B = require('./board');
process.on('message', function (jobs) {
  jobs.forEach(function (j) {
    try { B.layout({ metro: j.metro }, j.view, j.extra || undefined); } catch (e) { /* the case will report it */ }
  });
  process.exit(0);
});
