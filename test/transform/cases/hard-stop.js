'use strict';

// A SERVER THAT NEVER ANSWERS DOES NOT HOLD THE RENDER. The live plugin went
// degraded, "Transform timed out after 5s": a request is raced against the
// render's clock itself, not only aborted, so a runtime whose fetch ignores
// the abort still gets its board inside the platform's limit.

module.exports = function (test, h) {
  const { runTransform, baseInput, assert } = h;
  const NOW = Date.parse('2026-09-19T10:00:00Z');
  test('a feed that never answers, abort or no abort, costs the budget and no more', async () => {
    // never resolves, and pays no attention to the signal
    const net = () => new Promise(() => {});
    const { run } = runTransform(net, NOW);
    const t0 = Date.now();
    const r = await run(baseInput(NOW, { calendar_list: 'Alpha https://x.example/a.ics', setup_mode: 'links',
      news_feeds: 'https://x.example/news.xml' }));
    const took = Date.now() - t0;
    assert(took < 3800, 'the render took ' + took + 'ms');
    assert(r && r.data, 'no board');
  });
};
