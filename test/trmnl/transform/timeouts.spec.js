'use strict';

// Timeouts. The serverless runtime kills a render that runs long, so the
// question every fetch in transform.js has to answer is not "how long am I
// allowed" but "how much of the render is left". One dead feed must cost
// its own events and nothing else; a slow one must not be able to spend
// time the runtime was never going to give us.
//
// Where a case is about the real network (a dead feed, a slow forecast) it
// runs through trmnlp-test, against the real three second budget and a mock
// server that really is slow. Where it needs the clock moved from inside a
// fetch, a body that never follows its headers, or the abort signal a fetch
// carries, it stays on the old vm harness (vmTransform), which can say those
// things and trmnlp-test cannot.

require('../lib/transform').cases('timeouts', function (test, h) {
  const { runTransform, vmTransform, requestsOf, runOf, serve, status, otherwise, FORECAST, icsWithEvents, okText, fail, baseInput, eventItems, assert } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const A = 'https://a.example.com/a.ics';
  const B = 'https://b.example.com/b.ics';

  const icsText = (title) => icsWithEvents([
    { start: '20260909T140000Z', end: '20260909T150000Z', summary: title },
  ]);
  const icsFor = (title) => okText(icsText(title));

  function twoCalendars(extra) {
    return baseInput(NOW, Object.assign({
      use_demo_data: 'false',
      config_json: JSON.stringify({
        lines: [{ name: 'Alex' }, { name: 'Sam' }],
        calendars: [
          { url: A, name: 'Alex', rules: [{ match: { type: 'any' }, line: 'Alex' }] },
          { url: B, name: 'Sam', rules: [{ match: { type: 'any' }, line: 'Sam' }] },
        ],
      }),
    }, extra));
  }

  test('every fetch carries an abort signal, so nothing can hang for ever', async () => {
    // A fetch with no signal has no timeout at all: whatever the deadline
    // arithmetic says, the render sits on the socket until the runtime
    // kills it. This asserts the mechanism, not the arithmetic.
    // vm: the abort signal a fetch carries cannot be seen through a proxy
    const signals = [];
    const { run } = vmTransform(async (url, opts) => {
      signals.push({ url: String(url), signal: opts && opts.signal });
      if (String(url).indexOf('api.open-meteo.com') >= 0) return fail(503);
      if (String(url).indexOf('/i18n/') >= 0) return fail(404);
      return icsFor('Afternoon');
    }, NOW);
    const input = twoCalendars({ lat_lon: '51.05,3.72' });
    input.trmnl.user.locale = 'fr-BE'; // pulls in the language file too
    await run(input);
    assert(signals.length >= 3, 'expected the language file, the forecast and both feeds, saw ' + signals.length);
    for (const s of signals) {
      assert(s.signal && typeof s.signal.aborted === 'boolean', 'no abort signal on ' + s.url);
    }
  });

  test('one dead feed costs its own line, not the board', async () => {
    const { run } = runTransform([status(A, 404), otherwise(icsText('Sam Time'))], NOW);
    const r = await run(twoCalendars());
    const titles = eventItems(r.data).map((e) => e.title);
    assert(titles.indexOf('Sam Time') >= 0, 'the healthy feed was lost with the dead one: ' + titles.join(', '));
  });

  test('a feed that eats the whole deadline does not get to spend the next one', async () => {
    // The bug this is against: buildFromConfig used to start a FRESH 4.2s
    // deadline of its own, after the weather call had already spent up to
    // three seconds against run()'s. Two budgets, one runtime limit, and a
    // slow morning blew straight through it. There is one deadline now, so
    // a feed that arrives with nothing left of it is skipped rather than
    // being handed a new four seconds.
    // vm: the clock is moved from inside a fetch, so the second feed is
    // asked for after the first has spent the budget
    let now = NOW;
    const calls = [];
    const { run } = vmTransform(async (url) => {
      calls.push(String(url));
      if (String(url) === A) { now += 5000; return icsFor('Alex Time'); } // answers, but not in time for anyone else
      return icsFor('Sam Time');
    }, () => now);
    const r = await run(twoCalendars());
    assert(calls.indexOf(B) < 0, 'the second feed was fetched with no budget left: ' + calls.join(', '));
    assert(r.data, 'the render should still produce a board');
  });

  test('a slow forecast does not hold the feeds back: they are all asked for at once', async () => {
    // The language file, the forecast and the feeds were fetched one after
    // the other, so a forecast that took two seconds left the calendars one.
    //
    // Asked of the real runtime: the forecast answers four seconds late (it
    // is cut at the three second budget), the feeds at once. Fetched one
    // after the other, the feeds would be asked for with nothing left of the
    // budget and their events lost; fetched together, both are on the board.
    const r = await runTransform([
      status(FORECAST, 503, { delayMs: 4000 }),
      serve(A, icsText('Alex Time')), serve(B, icsText('Sam Time')),
    ], NOW).run(twoCalendars({ lat_lon: '51.05,3.72' }));
    const calls = requestsOf(r).map((q) => q.url);
    const feeds = calls.filter((u) => /\.ics$/.test(u));
    assert(feeds.length === 2, 'the feeds waited for the forecast: ' + calls.join(', '));
    const titles = eventItems(r.data).map((e) => e.title).sort();
    assert(titles.join(',') === 'Alex Time,Sam Time', 'the feeds lost their events to the forecast: ' + titles.join(', '));
  });

  test('a feed that answers at once and then sends its body slowly is cut at the deadline', async () => {
    // The timeout used to stop when the headers arrived, and the body had
    // all the time in the world. A's answer uses up all but a sliver of the
    // budget; B's headers come at once and its body never does.
    // Asked of the real runtime: A answers 2s in (a full second short of the
    // budget: closer than that, a busy machine lost A itself), B's headers come at
    // once and its body a minute later (bodyDelayMs). The render has to end
    // at the three second budget, not wait for the body: under the 3800ms
    // the hard-stop case allows (the budget plus node's own start-up).
    const r = await runTransform([status(FORECAST, 503),
      serve(A, icsText('Alex Time'), { delayMs: 2000 }),
      serve(B, icsText('Sam Time'), { bodyDelayMs: 60000 })], NOW).run(twoCalendars());
    const took = runOf(r).durationMs;
    assert(took < 3800, 'the render waited on a body that never came: ' + took + 'ms');
    const titles = eventItems(r.data).map((e) => e.title);
    assert(titles.indexOf('Alex Time') >= 0, 'the feed that answered was lost: ' + titles.join(', '));
  });
});
