'use strict';

// A SERVER THAT NEVER ANSWERS DOES NOT HOLD THE RENDER. The live plugin went
// degraded, "Transform timed out after 5s": a request is raced against the
// render's clock itself, not only aborted, so a runtime whose fetch ignores
// the abort still gets its board inside the platform's limit.

require('../lib/transform').cases('hard-stop', function (test, h) {
  const { runTransform, runOf, baseInput, otherwise, assert } = h;
  const NOW = Date.parse('2026-09-19T10:00:00Z');
  test('a feed that never answers, abort or no abort, costs the budget and no more', async () => {
    // never resolves in time: every server answers a minute late, through
    // the real runtime's own fetch and the mock proxy
    const net = [otherwise('', { delayMs: 60000 })];
    const { run } = runTransform(net, NOW);
    const r = await run(baseInput(NOW, { calendar_list: 'Alpha https://x.example/a.ics', setup_mode: 'links',
      news_feeds: 'https://x.example/news.xml' }));
    // the transform's own wall clock as the runtime measured it (node's
    // start-up included, which the old in-process harness never paid)
    const took = runOf(r).durationMs;
    assert(took < 3800, 'the render took ' + took + 'ms');
    assert(r && r.data, 'no board');
  });
});
