module.exports = function (test, h) {
  const { runTransform, assert } = h;

  function parse(raw) {
    return runTransform().parseConfig(JSON.stringify(raw));
  }

  test('word matcher: matches whole word only, not a substring of a longer one', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'L1' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('L1 Trip'), 'should match "L1 Trip"');
    assert(!rx.test('L10 Trip'), 'should NOT match "L10 Trip"');
    assert(!rx.test('XL1'), 'should NOT match "XL1"');
  });

  test('regex matcher uses the pattern as-is (expert escape hatch)', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'regex', value: '\\bK[123]\\b' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('K2 Assembly'), 'should match K2');
    assert(!rx.test('K4 Assembly'), 'should not match K4 (outside character class)');
  });

  test('"contains" matcher: plain substring anywhere, no word boundaries', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'contains', value: 'team' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('Steam Room'), 'should match mid-word, unlike "word"');
    assert(!rx.test('Tea Room'), 'should not match when the substring genuinely is not present');
  });

  test('"exact" matcher: the whole title must equal the value, nothing more', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'exact', value: 'Desk booking' }, hide: true }] }],
    });
    const rx = cfg.calendars[0].rules[0].rx;
    assert(rx.test('DESK BOOKING'), 'should still be case-insensitive');
    assert(!rx.test('Desk booking (extended)'), 'should not match a title that merely contains it');
  });

  test('"any"/"all" matcher matches every title, empty or not, no value needed', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'any' }, hide: true }] }],
    });
    assert(cfg.calendars[0].rules[0].rx.test(''), 'should match an empty title too');
    const cfg2 = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'all' }, hide: true }] }],
    });
    assert(cfg2.calendars[0].rules[0].rx.test('anything'), '"all" should be accepted as a synonym for "any"');
  });

  test('a rule naming a line leaves the title alone, whatever it matched', async () => {
    const { runTransform, icsWithEvents, okText, baseInput, eventItems, assertEqual } = h;
    const NOW = Date.parse('2026-09-08T12:00:00Z');
    const fetchImpl = async () => okText(icsWithEvents([{ start: '20260908T083000Z', end: '20260908T092000Z', summary: 'L6 - Zwemmen' }]));
    const cfg = JSON.stringify({ lines: [{ name: 'Alex' }], calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L6' }, line: 'Alex' }] }] });
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, { config_json: cfg }));
    assertEqual(eventItems(r.data).map((e) => e.title), ['L6 - Zwemmen'], 'routing renamed the title');
  });

  test('a rule with no match is dropped, not crash', () => {
    const cfg = parse({ calendars: [{ url: 'https://x/a.ics', rules: [{ hide: true }] }] });
    assert(cfg.calendars[0].rules.length === 0, 'a rule missing "match" entirely should be silently dropped');
  });

  test('a rule with no effect (no track/allDay/hide/rewrite) is dropped', () => {
    const cfg = parse({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L1' } }] }] });
    assert(cfg.calendars[0].rules.length === 0, 'a rule that does nothing should be dropped, not kept as a no-op');
  });

  test('a rule\'s track is normalized to an array even when given a single string', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L1' }, line: 'Alex', allDay: true }] }],
    });
    const rule = cfg.calendars[0].rules[0];
    assert(rule.allDay === true);
    assert(rule.hide === false, 'hide should default to false');
    assert(JSON.stringify(rule.line) === JSON.stringify(['Alex']));
  });

  test('a rule\'s track field also accepts a list directly', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'Dinner' }, line: ['Alex', 'Kids'] }] }],
    });
    assert(JSON.stringify(cfg.calendars[0].rules[0].line) === JSON.stringify(['Alex', 'Kids']));
  });

  test('a calendar rule with an invalid matcher (missing value) drops the rule, not the calendar', () => {
    const cfg = parse({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word' }, line: 'Alex' }] }] });
    assert(cfg.calendars[0].rules.length === 0);
    assert(cfg.calendars.length === 1, 'the calendar itself should still be kept');
  });

  test('global (top-level) rules compile separately from any calendar\'s own', () => {
    const cfg = parse({
      rules: [{ match: { type: 'word', value: 'Doctor' }, line: 'Mom' }],
      calendars: [{ url: 'https://x/a.ics' }],
    });
    assert(cfg.globalRules.length === 1, 'the top-level rule should compile');
    assert(cfg.calendars[0].rules.length === 0, 'it should not leak into the calendar\'s own rules');
  });

  function ctx(overrides) {
    return Object.assign({ title: '', desc: '', status: '', weekday: null }, overrides);
  }

  test('"and" matcher only matches when every sub-matcher matches', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{
        match: { type: 'and', matchers: [{ type: 'word', value: 'Standup' }, { type: 'weekday', value: 'FR' }] },
        hide: true,
      }] }],
    });
    const m = cfg.calendars[0].rules[0].match;
    assert(m(ctx({ title: 'Standup', weekday: 4 })), 'Friday (weekday 4) Standup should match');
    assert(!m(ctx({ title: 'Standup', weekday: 0 })), 'Monday Standup should NOT match');
    assert(!m(ctx({ title: 'Retro', weekday: 4 })), 'Friday Retro should NOT match');
  });

  test('"or" matcher matches when any sub-matcher matches', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{
        match: { type: 'or', matchers: [{ type: 'word', value: 'Vacation' }, { type: 'status', value: 'cancelled' }] },
        hide: true,
      }] }],
    });
    const m = cfg.calendars[0].rules[0].match;
    assert(m(ctx({ title: 'Vacation', status: 'CONFIRMED' })));
    assert(m(ctx({ title: 'Team Sync', status: 'CANCELLED' })));
    assert(!m(ctx({ title: 'Team Sync', status: 'CONFIRMED' })));
  });

  test('"not" matcher inverts its single sub-matcher', () => {
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{
        match: { type: 'not', matcher: { type: 'word', value: 'L2' } },
        hide: true,
      }] }],
    });
    const m = cfg.calendars[0].rules[0].match;
    assert(m(ctx({ title: 'L1 Trip' })), 'no "L2" present, so the negation matches');
    assert(!m(ctx({ title: 'L2 Trip' })), '"L2" present, so the negation does not match');
  });

  test('"not" combines with "and"/"or" to express "one of these, except that one" with no regex at all', () => {
    // The scenario that used to require a regex negative lookahead
    // (\b(?:L1|L3)\b)(?!.*\bL2\b) — a real source of bugs when the JSON is
    // hand-edited or pasted through something that mangles backslashes.
    const cfg = parse({
      calendars: [{ url: 'https://x/a.ics', rules: [{
        match: { type: 'and', matchers: [
          { type: 'or', matchers: [{ type: 'word', value: 'L1' }, { type: 'word', value: 'L3' }] },
          { type: 'not', matcher: { type: 'word', value: 'L2' } },
        ] },
        hide: true,
      }] }],
    });
    const m = cfg.calendars[0].rules[0].match;
    assert(m(ctx({ title: 'L1 - Gym' })), 'L1 alone should hide');
    assert(m(ctx({ title: 'L3 - Gym' })), 'L3 alone should hide');
    assert(!m(ctx({ title: 'L2 - Gym' })), 'L2 is not in the or-list, so it never matches');
    assert(!m(ctx({ title: 'L4 - Gym' })), 'L4 is not in the or-list either');
  });

  test('"status" matcher compares case-insensitively against the event\'s ICS STATUS', () => {
    const cfg = parse({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'status', value: 'tentative' }, hide: true }] }] });
    const m = cfg.calendars[0].rules[0].match;
    assert(m(ctx({ status: 'TENTATIVE' })));
    assert(!m(ctx({ status: 'CONFIRMED' })));
  });

  test('"weekday" matcher accepts a single day or a list, by 2-letter or full name', () => {
    const single = parse({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'weekday', value: 'Monday' }, hide: true }] }] }).calendars[0].rules[0].match;
    assert(single(ctx({ weekday: 0 })), 'weekday 0 (Monday) should match "Monday"');
    assert(!single(ctx({ weekday: 1 })));

    const list = parse({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'weekday', value: ['SA', 'SU'] }, hide: true }] }] }).calendars[0].rules[0].match;
    assert(list(ctx({ weekday: 5 })));
    assert(list(ctx({ weekday: 6 })));
    assert(!list(ctx({ weekday: 2 })));
  });

  test('a rule can hide events only on a specific weekday, end to end', async () => {
    const { runTransform, icsWithEvents, okText, baseInput, eventItems, assertEqual } = h;
    // A weekly-Monday-and-Wednesday-alike series, expressed as one weekly
    // master (matches every Monday from 2026-09-07 on) — checked against
    // two different "todays" since this plugin only ever shows one day.
    const events = [{ uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', summary: 'Weekly Sync' }];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const cfg = JSON.stringify({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'weekday', value: 'MO' }, hide: true }] }],
    });

    const MONDAY = Date.parse('2026-09-07T12:00:00Z');
    const rMon = await runTransform(fetchImpl, MONDAY).run(baseInput(MONDAY, { config_json: cfg }));
    assertEqual(eventItems(rMon.data).length, 0, 'Monday occurrence should be hidden by the weekday rule');

    const WEDNESDAY = Date.parse('2026-09-09T12:00:00Z');
    const rWed = await runTransform(fetchImpl, WEDNESDAY).run(baseInput(WEDNESDAY, { config_json: cfg }));
    assertEqual(eventItems(rWed.data).length, 1, 'Wednesday occurrence should still show — the rule only targets Monday');
  });

  test('"hide these class codes except two" works end to end with no regex (real-world config)', async () => {
    const { runTransform, icsWithEvents, okText, baseInput, eventItems, assertEqual } = h;
    // Mirrors a real reported config: a shared calendar lists every class's
    // activity (L1/L3/L4/L5/K1-3/Kleuter) under one feed; only L2 and L6
    // are this account's own kids, routed to them; everything else
    // should be hidden. The regex-based version of this rule
    // ((?=.*\b(?:L1345|K123|Kleuter)\b)(?!.*\b(?:L2|L6)\b)) is exactly the
    // kind of thing that gets mangled by a stray backslash when hand-typed
    // or pasted through something that re-escapes it — this and/or/not form
    // has no backslashes to mangle.
    const events = [
      { uid: 1, start: '20260908T083000Z', end: '20260908T092000Z', summary: 'L1 - Extra turnen' },
      { uid: 2, start: '20260908T083000Z', end: '20260908T092000Z', summary: 'L5 - Extra turnen' },
      { uid: 3, start: '20260908T092000Z', end: '20260908T101000Z', summary: 'L6 - Extra turnen' },
      { uid: 4, start: '20260908T092000Z', end: '20260908T101000Z', summary: 'L2 - Extra turnen' },
      { uid: 5, start: '20260908T130000Z', end: '20260908T144000Z', summary: 'L4 - Zwemmen' },
      { uid: 6, start: '20260908T130000Z', end: '20260908T144000Z', summary: 'L1 - Zwemmen' },
    ];
    const fetchImpl = async () => okText(icsWithEvents(events));
    const cfg = JSON.stringify({
      lines: [{ name: 'Familie' }, { name: 'Jules' }, { name: 'Remy' }],
      calendars: [{
        url: 'https://example.com/familie.ics', name: 'Familie',
        rules: [
          {
            match: { type: 'and', matchers: [
              { type: 'or', matchers: ['L1', 'L3', 'L4', 'L5', 'K1', 'K2', 'K3', 'Kleuter'].map((v) => ({ type: 'word', value: v })) },
              { type: 'not', matcher: { type: 'word', value: 'L2' } },
              { type: 'not', matcher: { type: 'word', value: 'L6' } },
            ] },
            hide: true,
          },
          { match: { type: 'word', value: 'L2' }, line: 'Jules' },
          { match: { type: 'word', value: 'L6' }, line: 'Remy' },
        ],
      }],
    });
    const NOW = Date.parse('2026-09-08T12:00:00Z');
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, { config_json: cfg }));
    const titles = eventItems(r.data).map((e) => e.title).sort();
    assertEqual(titles, ['L2 - Extra turnen', 'L6 - Extra turnen'], 'only L2/L6 should survive the hide rule');
  });
};
