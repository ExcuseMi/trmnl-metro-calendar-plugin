'use strict';

// Timeouts. The serverless runtime kills a render that runs long, so the
// question every fetch in transform.js has to answer is not "how long am I
// allowed" but "how much of the render is left". One dead feed must cost
// its own events and nothing else; a slow one must not be able to spend
// time the runtime was never going to give us.
//
// The clock here is a function (see runTransform in ../run.js) so a fake
// fetch can move it: waiting out the real 4.2 second deadline would put
// four idle seconds into the suite for every case below.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, eventItems, assert } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const A = 'https://a.example.com/a.ics';
  const B = 'https://b.example.com/b.ics';

  const icsFor = (title) => okText(icsWithEvents([
    { start: '20260909T140000Z', end: '20260909T150000Z', summary: title },
  ]));

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
    const signals = [];
    const { run } = runTransform(async (url, opts) => {
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
    const { run } = runTransform(async (url) => (String(url) === A ? fail(404) : icsFor('Sam Time')), NOW);
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
    let now = NOW;
    const calls = [];
    const { run } = runTransform(async (url) => {
      calls.push(String(url));
      if (String(url) === A) { now += 5000; return icsFor('Alex Time'); } // answers, but not in time for anyone else
      return icsFor('Sam Time');
    }, () => now);
    const r = await run(twoCalendars());
    assert(calls.indexOf(B) < 0, 'the second feed was fetched with no budget left: ' + calls.join(', '));
    assert(r.data, 'the render should still produce a board');
  });

  test('a slow forecast cannot push the calendars past the deadline', async () => {
    // Same single deadline seen from the other end: the weather call is
    // budgeted against the SAME clock the feeds are, so a forecast that
    // takes the lot leaves the calendars nothing rather than starting over.
    let now = NOW;
    const calls = [];
    const { run } = runTransform(async (url) => {
      calls.push(String(url));
      if (String(url).indexOf('api.open-meteo.com') >= 0) { now += 5000; return fail(503); }
      return icsFor('Afternoon');
    }, () => now);
    await run(twoCalendars({ lat_lon: '51.05,3.72' }));
    const feeds = calls.filter((u) => /\.ics$/.test(u));
    assert(feeds.length === 0, 'a feed was fetched after the deadline had passed: ' + feeds.join(', '));
  });
};
