// Whether a line with nothing on today is drawn anyway.
//
// A line NAMED IN `lines[]` is: somebody wrote that person's name down, and
// a board that deletes them on their quiet day is a board that changes
// shape daily and hides the answer you came to it for. `hideWhenEmpty: true`
// drops it, for a line that only matters on the days it is used.
//
// A line that exists only because a CALENDAR is named is not the same
// thing, and keeps the old default: a feed called "School" whose events all
// get routed to the children is a router, not a person, and an empty School
// rail is noise. `keepLine: true` on the calendar keeps it.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, eventItems, assert } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const BUSY = 'https://cal.example.com/busy.ics';
  const QUIET = 'https://cal.example.com/quiet.ics';

  // one feed with something on today, one with nothing at all
  const busyIcs = icsWithEvents([{ summary: 'Standup', start: '20260909T090000Z', end: '20260909T091500Z' }]);
  const emptyIcs = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Quiet\r\nEND:VCALENDAR\r\n';

  function serve(opts) {
    return async (url) => {
      if (String(url) === BUSY) return okText(busyIcs);
      if (String(url) === QUIET) return (opts && opts.down) ? fail(503) : okText(emptyIcs);
      return fail(404);
    };
  }

  function board(cfg, opts) {
    const { run } = runTransform(serve(opts), NOW);
    return run(baseInput(NOW, { use_demo_data: 'false', config_json: JSON.stringify(cfg) }));
  }

  const TRACKS = (r) => r.data.legend.map((t) => t.name).sort().join(',');

  test('a line somebody named is on the board on its quiet day too', async () => {
    const r = await board({
      lines: [{ name: 'Busy' }, { name: 'Quiet' }],
      calendars: [
        { name: 'Busy', url: BUSY, rules: [{ match: { type: 'any' }, line: 'Busy' }] },
        { name: 'Quiet', url: QUIET, rules: [{ match: { type: 'any' }, line: 'Quiet' }] },
      ],
    });
    assert(TRACKS(r) === 'Busy,Quiet', 'got ' + TRACKS(r));
    // and it really is empty: nothing was invented to fill it
    assert(eventItems(r.data).length === 1, 'expected the one real event, got ' + eventItems(r.data).length);
  });

  test('a calendar that only routes elsewhere does not become an empty rail', async () => {
    // "School" sends every entry to a child by class code and owns no line
    // of its own. Named, so the rules can talk about it; drawn, it would be
    // a rail with nobody on it.
    const r = await board({
      lines: [{ name: 'Busy' }],
      calendars: [
        { name: 'Busy', url: BUSY, rules: [{ match: { type: 'any' }, line: 'Busy' }] },
        { name: 'School', url: QUIET, rules: [{ match: { type: 'any' }, line: 'Busy' }] },
      ],
    });
    assert(TRACKS(r) === 'Busy', 'got ' + TRACKS(r));
  });

  test('keepLine on a calendar keeps the line that calendar owns', async () => {
    const r = await board({
      calendars: [
        { name: 'Busy', url: BUSY },
        { name: 'Quiet', url: QUIET, keepLine: true },
      ],
    });
    assert(TRACKS(r) === 'Busy,Quiet', 'got ' + TRACKS(r));
  });

  test('a kept calendar survives its feed being down, not just being empty', async () => {
    // a feed unreachable for an hour should not silently remove somebody
    const r = await board({
      calendars: [
        { name: 'Busy', url: BUSY },
        { name: 'Quiet', url: QUIET, keepLine: true },
      ],
    }, { down: true });
    assert(TRACKS(r) === 'Busy,Quiet', 'got ' + TRACKS(r));
  });

  test('an unnamed kept calendar takes its line name from the feed', async () => {
    const r = await board({
      calendars: [
        { name: 'Busy', url: BUSY },
        { url: QUIET, keepLine: true },
      ],
    });
    assert(TRACKS(r) === 'Busy,Quiet', 'got ' + TRACKS(r));
  });

  test('hideWhenEmpty drops a line that is only worth drawing when used', async () => {
    const r = await board({
      lines: [{ name: 'Busy' }, { name: 'Quiet', hideWhenEmpty: true }],
      calendars: [
        { name: 'Busy', url: BUSY, rules: [{ match: { type: 'any' }, line: 'Busy' }] },
        { name: 'Quiet', url: QUIET, rules: [{ match: { type: 'any' }, line: 'Quiet' }] },
      ],
    });
    assert(TRACKS(r) === 'Busy', 'got ' + TRACKS(r));
  });
};
