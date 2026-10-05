# frozen_string_literal: true

require_relative '../support/transform'

RSpec.describe 'matchers' do
  include Metro::Transform

  # parseConfig is internal to transform.js, with no entry point a runtime
  # can call: asked in plain node. What it compiles (a RegExp, a function)
  # cannot leave node, so each case asks its questions there, in `body`
  # (`parse` and `ctx` as the cases always had them, `args.raw` the config),
  # and asserts here on the answers.
  prelude = <<~JS
    const parse = (raw) => T.parseConfig(JSON.stringify(raw));
    const ctx = (overrides) => Object.assign({ title: '', desc: '', status: '', weekday: null }, overrides);
  JS
  define_method(:parsed) do |raw, body|
    internals(prelude + body, args: { raw: })
  end

  it 'word matcher: matches whole word only, not a substring of a longer one' do
    got = parsed({
      calendars: [{ url: 'https://x/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'L1' }, hide: true }] }]
    }, <<~JS)
      const cfg = parse(args.raw);
      const rx = cfg.calendars[0].rules[0].rx;
      return [rx.test('L1 Trip'), rx.test('L10 Trip'), rx.test('XL1')];
    JS
    assert(got[0], 'should match "L1 Trip"')
    assert(!got[1], 'should NOT match "L10 Trip"')
    assert(!got[2], 'should NOT match "XL1"')
  end

  it 'regex matcher uses the pattern as-is (expert escape hatch)' do
    got = parsed({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'regex', value: '\\bK[123]\\b' }, hide: true }] }]
    }, <<~JS)
      const cfg = parse(args.raw);
      const rx = cfg.calendars[0].rules[0].rx;
      return [rx.test('K2 Assembly'), rx.test('K4 Assembly')];
    JS
    assert(got[0], 'should match K2')
    assert(!got[1], 'should not match K4 (outside character class)')
  end

  it '"contains" matcher: plain substring anywhere, no word boundaries' do
    got = parsed({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'contains', value: 'team' }, hide: true }] }]
    }, <<~JS)
      const cfg = parse(args.raw);
      const rx = cfg.calendars[0].rules[0].rx;
      return [rx.test('Steam Room'), rx.test('Tea Room')];
    JS
    assert(got[0], 'should match mid-word, unlike "word"')
    assert(!got[1], 'should not match when the substring genuinely is not present')
  end

  it '"exact" matcher: the whole title must equal the value, nothing more' do
    got = parsed({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'exact', value: 'Desk booking' }, hide: true }] }]
    }, <<~JS)
      const cfg = parse(args.raw);
      const rx = cfg.calendars[0].rules[0].rx;
      return [rx.test('DESK BOOKING'), rx.test('Desk booking (extended)')];
    JS
    assert(got[0], 'should still be case-insensitive')
    assert(!got[1], 'should not match a title that merely contains it')
  end

  it '"any"/"all" matcher matches every title, empty or not, no value needed' do
    got = parsed({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'any' }, hide: true }] }]
    }, <<~JS)
      const cfg = parse(args.raw);
      return cfg.calendars[0].rules[0].rx.test('');
    JS
    assert(got, 'should match an empty title too')
    got2 = parsed({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'all' }, hide: true }] }]
    }, <<~JS)
      const cfg2 = parse(args.raw);
      return cfg2.calendars[0].rules[0].rx.test('anything');
    JS
    assert(got2, '"all" should be accepted as a synonym for "any"')
  end

  it 'a rule naming a line leaves the title alone, whatever it matched' do
    now = ms('2026-09-08T12:00:00Z')
    fetch_impl = [otherwise(ics_with_events([{ start: '20260908T083000Z', end: '20260908T092000Z', summary: 'L6 - Zwemmen' }]))]
    cfg = JSON.generate(lines: [{ name: 'Alex' }], calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L6' }, line: 'Alex' }] }])
    r = run_transform(fetch_impl, now, base_input(now, config_json: cfg))
    assert_equal(event_items(r['data']).map { it['title'] }, ['L6 - Zwemmen'], 'routing renamed the title')
  end

  it 'a rule with no match is dropped, not crash' do
    got = parsed({ calendars: [{ url: 'https://x/a.ics', rules: [{ hide: true }] }] }, <<~JS)
      const cfg = parse(args.raw);
      return cfg.calendars[0].rules.length === 0;
    JS
    assert(got, 'a rule missing "match" entirely should be silently dropped')
  end

  it 'a rule with no effect (no track/allDay/hide/rewrite) is dropped' do
    got = parsed({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L1' } }] }] }, <<~JS)
      const cfg = parse(args.raw);
      return cfg.calendars[0].rules.length === 0;
    JS
    assert(got, 'a rule that does nothing should be dropped, not kept as a no-op')
  end

  it "a rule's track is normalized to an array even when given a single string" do
    got = parsed({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'L1' }, line: 'Alex', allDay: true }] }]
    }, <<~JS)
      const cfg = parse(args.raw);
      const rule = cfg.calendars[0].rules[0];
      return [rule.allDay === true, rule.hide === false, JSON.stringify(rule.line) === JSON.stringify(['Alex'])];
    JS
    assert(got[0])
    assert(got[1], 'hide should default to false')
    assert(got[2])
  end

  it "a rule's track field also accepts a list directly" do
    got = parsed({
      calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word', value: 'Dinner' }, line: %w[Alex Kids] }] }]
    }, <<~JS)
      const cfg = parse(args.raw);
      return JSON.stringify(cfg.calendars[0].rules[0].line) === JSON.stringify(['Alex', 'Kids']);
    JS
    assert(got)
  end

  it 'a calendar rule with an invalid matcher (missing value) drops the rule, not the calendar' do
    got = parsed({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'word' }, line: 'Alex' }] }] }, <<~JS)
      const cfg = parse(args.raw);
      return [cfg.calendars[0].rules.length === 0, cfg.calendars.length === 1];
    JS
    assert(got[0])
    assert(got[1], 'the calendar itself should still be kept')
  end

  it "global (top-level) rules compile separately from any calendar's own" do
    got = parsed({
      rules: [{ match: { type: 'word', value: 'Doctor' }, line: 'Mom' }],
      calendars: [{ url: 'https://x/a.ics' }]
    }, <<~JS)
      const cfg = parse(args.raw);
      return [cfg.globalRules.length === 1, cfg.calendars[0].rules.length === 0];
    JS
    assert(got[0], 'the top-level rule should compile')
    assert(got[1], "it should not leak into the calendar's own rules")
  end

  it '"and" matcher only matches when every sub-matcher matches' do
    got = parsed({
      calendars: [{ url: 'https://x/a.ics', rules: [{
        match: { type: 'and', matchers: [{ type: 'word', value: 'Standup' }, { type: 'weekday', value: 'FR' }] },
        hide: true
      }] }]
    }, <<~JS)
      const cfg = parse(args.raw);
      const m = cfg.calendars[0].rules[0].match;
      return [!!m(ctx({ title: 'Standup', weekday: 4 })), !!m(ctx({ title: 'Standup', weekday: 0 })), !!m(ctx({ title: 'Retro', weekday: 4 }))];
    JS
    assert(got[0], 'Friday (weekday 4) Standup should match')
    assert(!got[1], 'Monday Standup should NOT match')
    assert(!got[2], 'Friday Retro should NOT match')
  end

  it '"or" matcher matches when any sub-matcher matches' do
    got = parsed({
      calendars: [{ url: 'https://x/a.ics', rules: [{
        match: { type: 'or', matchers: [{ type: 'word', value: 'Vacation' }, { type: 'status', value: 'cancelled' }] },
        hide: true
      }] }]
    }, <<~JS)
      const cfg = parse(args.raw);
      const m = cfg.calendars[0].rules[0].match;
      return [!!m(ctx({ title: 'Vacation', status: 'CONFIRMED' })), !!m(ctx({ title: 'Team Sync', status: 'CANCELLED' })), !!m(ctx({ title: 'Team Sync', status: 'CONFIRMED' }))];
    JS
    assert(got[0])
    assert(got[1])
    assert(!got[2])
  end

  it '"not" matcher inverts its single sub-matcher' do
    got = parsed({
      calendars: [{ url: 'https://x/a.ics', rules: [{
        match: { type: 'not', matcher: { type: 'word', value: 'L2' } },
        hide: true
      }] }]
    }, <<~JS)
      const cfg = parse(args.raw);
      const m = cfg.calendars[0].rules[0].match;
      return [!!m(ctx({ title: 'L1 Trip' })), !!m(ctx({ title: 'L2 Trip' }))];
    JS
    assert(got[0], 'no "L2" present, so the negation matches')
    assert(!got[1], '"L2" present, so the negation does not match')
  end

  it '"not" combines with "and"/"or" to express "one of these, except that one" with no regex at all' do
    # The scenario that used to require a regex negative lookahead
    # (\b(?:L1|L3)\b)(?!.*\bL2\b) -- a real source of bugs when the JSON is
    # hand-edited or pasted through something that mangles backslashes.
    got = parsed({
      calendars: [{ url: 'https://x/a.ics', rules: [{
        match: { type: 'and', matchers: [
          { type: 'or', matchers: [{ type: 'word', value: 'L1' }, { type: 'word', value: 'L3' }] },
          { type: 'not', matcher: { type: 'word', value: 'L2' } }
        ] },
        hide: true
      }] }]
    }, <<~JS)
      const cfg = parse(args.raw);
      const m = cfg.calendars[0].rules[0].match;
      return [!!m(ctx({ title: 'L1 - Gym' })), !!m(ctx({ title: 'L3 - Gym' })), !!m(ctx({ title: 'L2 - Gym' })), !!m(ctx({ title: 'L4 - Gym' }))];
    JS
    assert(got[0], 'L1 alone should hide')
    assert(got[1], 'L3 alone should hide')
    assert(!got[2], 'L2 is not in the or-list, so it never matches')
    assert(!got[3], 'L4 is not in the or-list either')
  end

  it %q("status" matcher compares case-insensitively against the event's ICS STATUS) do
    got = parsed({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'status', value: 'tentative' }, hide: true }] }] }, <<~JS)
      const cfg = parse(args.raw);
      const m = cfg.calendars[0].rules[0].match;
      return [!!m(ctx({ status: 'TENTATIVE' })), !!m(ctx({ status: 'CONFIRMED' }))];
    JS
    assert(got[0])
    assert(!got[1])
  end

  it '"weekday" matcher accepts a single day or a list, by 2-letter or full name' do
    got = parsed({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'weekday', value: 'Monday' }, hide: true }] }] }, <<~JS)
      const single = parse(args.raw).calendars[0].rules[0].match;
      return [!!single(ctx({ weekday: 0 })), !!single(ctx({ weekday: 1 }))];
    JS
    assert(got[0], 'weekday 0 (Monday) should match "Monday"')
    assert(!got[1])

    got = parsed({ calendars: [{ url: 'https://x/a.ics', rules: [{ match: { type: 'weekday', value: %w[SA SU] }, hide: true }] }] }, <<~JS)
      const list = parse(args.raw).calendars[0].rules[0].match;
      return [!!list(ctx({ weekday: 5 })), !!list(ctx({ weekday: 6 })), !!list(ctx({ weekday: 2 }))];
    JS
    assert(got[0])
    assert(got[1])
    assert(!got[2])
  end

  it 'a rule can hide events only on a specific weekday, end to end' do
    # A weekly-Monday-and-Wednesday-alike series, expressed as one weekly
    # master (matches every Monday from 2026-09-07 on) -- checked against
    # two different "todays" since this plugin only ever shows one day.
    events = [{ uid: 1, start: '20260907T140000Z', end: '20260907T150000Z', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', summary: 'Weekly Sync' }]
    fetch_impl = [otherwise(ics_with_events(events))]
    cfg = JSON.generate(
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'weekday', value: 'MO' }, hide: true }] }]
    )

    monday = ms('2026-09-07T12:00:00Z')
    r_mon = run_transform(fetch_impl, monday, base_input(monday, config_json: cfg))
    assert_equal(event_items(r_mon['data']).length, 0, 'Monday occurrence should be hidden by the weekday rule')

    wednesday = ms('2026-09-09T12:00:00Z')
    r_wed = run_transform(fetch_impl, wednesday, base_input(wednesday, config_json: cfg))
    assert_equal(event_items(r_wed['data']).length, 1, 'Wednesday occurrence should still show -- the rule only targets Monday')
  end

  it '"hide these class codes except two" works end to end with no regex (real-world config)' do
    # Mirrors a real reported config: a shared calendar lists every class's
    # activity (L1/L3/L4/L5/K1-3/Kleuter) under one feed; only L2 and L6
    # are this account's own kids, routed to them; everything else
    # should be hidden. The regex-based version of this rule
    # ((?=.*\b(?:L1345|K123|Kleuter)\b)(?!.*\b(?:L2|L6)\b)) is exactly the
    # kind of thing that gets mangled by a stray backslash when hand-typed
    # or pasted through something that re-escapes it -- this and/or/not form
    # has no backslashes to mangle.
    events = [
      { uid: 1, start: '20260908T083000Z', end: '20260908T092000Z', summary: 'L1 - Extra turnen' },
      { uid: 2, start: '20260908T083000Z', end: '20260908T092000Z', summary: 'L5 - Extra turnen' },
      { uid: 3, start: '20260908T092000Z', end: '20260908T101000Z', summary: 'L6 - Extra turnen' },
      { uid: 4, start: '20260908T092000Z', end: '20260908T101000Z', summary: 'L2 - Extra turnen' },
      { uid: 5, start: '20260908T130000Z', end: '20260908T144000Z', summary: 'L4 - Zwemmen' },
      { uid: 6, start: '20260908T130000Z', end: '20260908T144000Z', summary: 'L1 - Zwemmen' }
    ]
    fetch_impl = [otherwise(ics_with_events(events))]
    cfg = JSON.generate(
      lines: [{ name: 'Familie' }, { name: 'Jules' }, { name: 'Remy' }],
      calendars: [{
        url: 'https://example.com/familie.ics', name: 'Familie',
        rules: [
          {
            match: { type: 'and', matchers: [
              { type: 'or', matchers: %w[L1 L3 L4 L5 K1 K2 K3 Kleuter].map { |v| { type: 'word', value: v } } },
              { type: 'not', matcher: { type: 'word', value: 'L2' } },
              { type: 'not', matcher: { type: 'word', value: 'L6' } }
            ] },
            hide: true
          },
          { match: { type: 'word', value: 'L2' }, line: 'Jules' },
          { match: { type: 'word', value: 'L6' }, line: 'Remy' }
        ]
      }]
    )
    now = ms('2026-09-08T12:00:00Z')
    r = run_transform(fetch_impl, now, base_input(now, config_json: cfg))
    titles = event_items(r['data']).map { it['title'] }.sort
    assert_equal(titles, ['L2 - Extra turnen', 'L6 - Extra turnen'], 'only L2/L6 should survive the hide rule')
  end
end
