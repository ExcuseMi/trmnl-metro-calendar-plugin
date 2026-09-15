// ONE EVENT, DRAWN ONCE, and the lines that share it laid out together.
//
// Two calendars can describe the same thing. Bart's "L6 School Day" and
// Lisa's "L2 School Day" both rename to "School Day", run the same hours,
// and are the same school day; they arrived as two events and were drawn
// twice, with two captions, on lines that could be at opposite ends of the
// board. These check that they arrive as one, and that sharing an event is
// what decides which lines end up next to each other.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, eventItems, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-07T12:00:00Z'); // a Monday
  const cfgWith = (json) => ({ config_json: JSON.stringify(json) });

  // two calendars, each naming the same meeting for a different person
  function twoFeeds(summaryA, summaryB, timeA, timeB) {
    return async (url) => okText(icsWithEvents([
      String(url).indexOf('/a.ics') >= 0
        ? { start: timeA[0], end: timeA[1], summary: summaryA }
        : { start: timeB[0], end: timeB[1], summary: summaryB },
    ]));
  }

  const SAME = [['20260907T140000Z', '20260907T150000Z'], ['20260907T140000Z', '20260907T150000Z']];

  test('the same event on two calendars becomes one event on both lines', async () => {
    const r = await runTransform(twoFeeds('Swim Class', 'Swim Class', SAME[0], SAME[1]), NOW)
      .run(baseInput(NOW, cfgWith({
        lines: [{ name: 'Ada' }, { name: 'Bo' }],
        calendars: [
          { url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Ada' }] },
          { url: 'https://example.com/b.ics', rules: [{ match: { type: 'any' }, line: 'Bo' }] },
        ],
      })));
    const swims = eventItems(r.data).filter((e) => e.title === 'Swim Class');
    assertEqual(swims.length, 1, 'one swim class, not two');
    assertEqual((swims[0].co_owners || []).length, 1, 'the second line should be a co-owner, not a second event');
  });

  test('two events with the same title at DIFFERENT times stay two events', async () => {
    const r = await runTransform(twoFeeds('Swim Class', 'Swim Class',
      ['20260907T140000Z', '20260907T150000Z'], ['20260907T160000Z', '20260907T170000Z']), NOW)
      .run(baseInput(NOW, cfgWith({
        lines: [{ name: 'Ada' }, { name: 'Bo' }],
        calendars: [
          { url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Ada' }] },
          { url: 'https://example.com/b.ics', rules: [{ match: { type: 'any' }, line: 'Bo' }] },
        ],
      })));
    assertEqual(eventItems(r.data).filter((e) => e.title === 'Swim Class').length, 2,
      'two o\'clock and four o\'clock are not the same lesson');
  });

  // Six and a half hours, which is the length that makes a block a long one.
  // Nothing declares that: the config cannot ask for it and transform.js
  // does not label it, so the only way a long block could be treated
  // differently here is by accident.
  const LONG = [['20260907T083000Z', '20260907T150000Z'], ['20260907T083000Z', '20260907T150000Z']];

  test('the same long event on two calendars is one event with a co-owner', async () => {
    // Deduping has to work the same for a school day as for a swim class.
    // It did not: a long block was split off into a payload of its own
    // BEFORE the two copies could be recognised as one thing, so both
    // children were drawn separately and the school was captioned twice.
    const r = await runTransform(twoFeeds('School Day', 'School Day', LONG[0], LONG[1]), NOW)
      .run(baseInput(NOW, cfgWith({
        lines: [{ name: 'Ada' }, { name: 'Bo' }],
        calendars: [
          { url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Ada' }] },
          { url: 'https://example.com/b.ics', rules: [{ match: { type: 'any' }, line: 'Bo' }] },
        ],
      })));
    const st = eventItems(r.data).filter((s) => s.title === 'School Day');
    assertEqual(st.length, 1, 'one school day, not one per child');
    assertEqual(st[0].co_owners.length, 1, 'both children really are at school, so both lines are on it');
    assert(st[0].co_owners[0] !== st[0].owner, 'the two of them are different lines');
    assertEqual([st[0].start_min, st[0].end_min], [8 * 60 + 30, 15 * 60], 'and it keeps the hours it ran');
  });

  test('lines that share an event are laid out next to each other', async () => {
    // Ada and Cy share nothing; Bo shares a class with each of them. The
    // board is a chain — outermost left ... spine ... outermost right — so
    // "next to each other" means consecutive in track_offset order across
    // the whole board, and Bo must sit between the two.
    const feeds = async (url) => {
      const which = String(url).match(/\/(\w+)\.ics/)[1];
      if (which === 'a') return okText(icsWithEvents([{ start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Shared One' }]));
      if (which === 'b') return okText(icsWithEvents([
        { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Shared One' },
        { start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Shared Two' },
      ]));
      return okText(icsWithEvents([{ start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Shared Two' }]));
    };
    const r = await runTransform(feeds, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Ada' }, { name: 'Bo' }, { name: 'Cy' }],
      calendars: [
        { url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Ada' }] },
        { url: 'https://example.com/b.ics', rules: [{ match: { type: 'any' }, line: 'Bo' }] },
        { url: 'https://example.com/c.ics', rules: [{ match: { type: 'any' }, line: 'Cy' }] },
      ],
    })));
    // ARRANGED, not as the payload lists them: the order is the solver's now
    // (solver/order.js), and what transform sends is the household's own
    // list. `arranged` runs the two together, which is what the board does.
    const board = h.arranged(r.data).slice()
      .sort((x, y) => x.line_offset - y.line_offset).map((t) => t.name);
    assertEqual(board.length, 3, 'three lines');
    assertEqual(board[1], 'Bo',
      'Bo shares an event with each of the others, so Bo belongs between them; got ' + board.join(' '));
  });

  test('the order is the one that crosses least, not the one greed reaches first', async () => {
    // Every line sitting between two people who share an event is a line
    // their lines have to cross to reach each other, and since a shared
    // event MOVES the trunks rather than dropping a rail from each, that
    // crossing is real ink. So the order to draw is the one with fewest of
    // them, and a household is small enough to find it exactly.
    //
    // These four events are a set greed gets wrong: it takes the strongest
    // pair first and extends from the ends, which here reaches an order
    // costing two crossings when one is available. The test does not name
    // the right answer -- it works out the best any order could do and
    // insists on it, because there is usually more than one and naming one
    // of them would be testing this run rather than the rule.
    const at = (h) => ['20260907T' + h + '0000Z', '20260907T' + (h + 1) + '0000Z'];
    const who = { a: 'Ada', b: 'Bo', c: 'Cy', d: 'Di', e: 'Ed' };
    const shared = [
      { at: 9, with: ['b', 'e'], title: 'Morning Stand' },
      { at: 11, with: ['c', 'd', 'e'], title: 'Late Review' },
      { at: 13, with: ['b', 'd'], title: 'Lunch Run' },
      { at: 16, with: ['c', 'e'], title: 'Evening Call' },
    ];
    const feeds = async (url) => {
      const me = String(url).match(/\/(\w)\.ics/)[1];
      // one of their own each, so nobody's line is dropped for being empty:
      // a shared event belongs to its primary owner, and the others would
      // have nothing of their own to keep them on the board
      const mine = [{ start: at(19)[0], end: at(19)[1], summary: 'Errand ' + me }];
      shared.forEach((g) => {
        if (g.with.indexOf(me) >= 0) mine.push({ start: at(g.at)[0], end: at(g.at)[1], summary: g.title });
      });
      return okText(icsWithEvents(mine));
    };
    const r = await runTransform(feeds, NOW).run(baseInput(NOW, cfgWith({
      lines: Object.keys(who).map((k) => ({ name: who[k] })),
      calendars: Object.keys(who).map((k) => ({
        url: 'https://example.com/' + k + '.ics',
        rules: [{ match: { type: 'any' }, line: who[k] }],
      })),
    })));
    // ARRANGED, not as the payload lists them: the order is the solver's now
    // (solver/order.js), and what transform sends is the household's own
    // list. `arranged` runs the two together, which is what the board does.
    const board = h.arranged(r.data).slice()
      .sort((x, y) => x.line_offset - y.line_offset).map((t) => t.name);
    assertEqual(board.length, 5, 'five lines: ' + board.join(' '));
    // The groups as the BOARD has them, not as this test declared them:
    // what matters is that the order is the best one for the events that
    // actually came out shared, and reading them back is also the only way
    // the two halves of the check can be talking about the same thing.
    const byKey = {};
    r.data.legend.forEach((l) => { byKey[l.key] = l.name; });
    const groups = r.data.events
      .filter((e) => e.co_owners && e.co_owners.length)
      .map((e) => [e.owner].concat(e.co_owners).map((k) => byKey[k]).filter(Boolean));
    assert(groups.length >= 3, 'only ' + groups.length + ' shared event(s) came out; nothing to order for');
    const cost = (seq) => groups.reduce((sum, g) => {
      const ix = g.map((n) => seq.indexOf(n)).sort((x, y) => x - y);
      let between = 0;
      for (let i = ix[0] + 1; i < ix[ix.length - 1]; i++) if (ix.indexOf(i) < 0) between++;
      return sum + between;
    }, 0);
    let floor = Infinity;
    const walk = (seq, k) => {
      if (k === seq.length) { floor = Math.min(floor, cost(seq)); return; }
      for (let i = k; i < seq.length; i++) {
        const t = seq[k]; seq[k] = seq[i]; seq[i] = t;
        walk(seq, k + 1);
        const u = seq[k]; seq[k] = seq[i]; seq[i] = u;
      }
    };
    walk(board.slice(), 0);
    assertEqual(cost(board), floor,
      'the board crosses ' + cost(board) + ' times where ' + floor + ' was available: ' + board.join(' '));
  });

  test('the day stretches to fit what is on it, with room after the last event', async () => {
    // Asked before the window's first step of the day: from ten the board
    // rolls the early morning off, and this case is about how one whole
    // day's window fits its own content.
    const EARLY = Date.parse('2026-09-07T05:00:00Z');
    // A fixed 7am-to-9pm day cut the ends off and left a late event's label
    // nothing to run into. The window now reaches an hour before the first
    // thing and an hour and a half after the last.
    const r = await runTransform(async () => okText(icsWithEvents([
      { start: '20260907T043000Z', end: '20260907T053000Z', summary: 'Early Shift' },
      { start: '20260907T200000Z', end: '20260907T203000Z', summary: 'Late Call' },
      // A THIRD EVENT SO THE DAY STAYS ITS OWN. Two is a quiet day and a
      // quiet day borrows the next one; this case is about how ONE day's
      // window fits its own content, and it used to ask for that with
      // `rolling_view: 'one'`. That setting is gone -- a board that quietly
      // shows more of what is coming needs no opt-out -- so the day has to
      // earn being one day, the way a real board does.
      { start: '20260907T120000Z', end: '20260907T130000Z', summary: 'Midday' },
    ])), EARLY).run(baseInput(EARLY, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal' }],
    })));
    const items = eventItems(r.data);
    const first = Math.min.apply(null, items.map((e) => e.start_min));
    const last = Math.max.apply(null, items.map((e) => e.end_min));
    assert(r.data.day_start_min <= first, 'the day starts at or before the first event, got '
      + r.data.day_start_min + ' vs ' + first);
    assert(r.data.day_end_min >= last + 60,
      'the day should leave at least an hour past the last event for its label, got '
      + r.data.day_end_min + ' vs ' + last);
    // ...and inside the run it gathered, which is two days where there is a
    // tomorrow to send. What of it gets DRAWN is `day.js opened()` and
    // `framed()`, against a view.
    assert(r.data.day_start_min >= 0 && r.data.day_end_min <= 48 * 60,
      'and stay inside the run it gathered');
  });
};
