module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, eventItems, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-07T12:00:00Z'); // a Monday

  function cfgWith(json) {
    return { config_json: JSON.stringify(json) };
  }

  test('a rule can turn a timed event into an all-day one, which then runs the whole day', async () => {
    // The event says 14:00 to 15:00; the rule says the training is a
    // whole-day thing. The rule wins, and the hour it came in with is
    // gone. There was a stretch when the plugin had nowhere to put an
    // all-day event and quietly dropped it, so the one assertion worth
    // making is that it is still on the board.
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Staff Training Day' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Training' }, allDay: true }] }],
    })));
    // Promoted OFF the axis: an all-day event has no hour, so it is not an
    // item at all. It is declared at the head of whichever lines are in it.
    assertEqual(eventItems(r.data), [], 'nothing on the timeline');
    assertEqual(r.data.all_day.map((a) => a.title), ['Staff Training Day'],
      'the rule promoted it');
  });

  test('a rule can hide an event by title match', async () => {
    const evA = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Keep Me' };
    const evB = { start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Hide Me' };
    const fetchImpl = async () => okText(icsWithEvents([evA, evB]));
    const { run } = runTransform(fetchImpl, NOW);
    const r = await run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Hide Me' }, hide: true }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Keep Me']);
  });

  test('a rule can match against an event\'s description, but only when the calendar opts in via includeDescription', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Team Sync', description: 'cancelled' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const cfgOff = { calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'cancelled' }, hide: true }] }] };
    const rOff = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith(cfgOff)));
    assertEqual(eventItems(rOff.data).length, 1, 'without includeDescription, the desc is never parsed, so the rule can\'t see it');

    const cfgOn = { calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', includeDescription: true, rules: [{ match: { type: 'word', value: 'cancelled' }, hide: true }] }] };
    const rOn = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith(cfgOn)));
    assertEqual(eventItems(rOn.data).length, 0, 'with includeDescription, the rule sees the description and hides it');
  });

  test('a rewrite rule replaces the matched text with literal text, independent of track', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'L6' }, rewrite: 'Lesson 6' }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Lesson 6 Swim Class']);
  });

  test('deleting the matched text takes the gap it leaves with it', async () => {
    // Stripping a class code is the commonest thing anybody writes a rule
    // for, and it is written as an empty rewrite. "L2 Zwemmen" came back as
    // " Zwemmen" -- printed on the panel as a caption indented by a space
    // nobody could account for -- and a code cut out of the middle left two
    // spaces behind. A rewrite is a cut; it takes the hole with it.
    const fetchImpl = async () => okText(icsWithEvents([
      { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L2 Zwemmen' },
      { start: '20260907T160000Z', end: '20260907T170000Z', summary: 'Turnen L2 zaal' },
    ]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal',
        rules: [{ match: { type: 'word', value: 'L2' }, rewrite: '' }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Zwemmen', 'Turnen zaal']);
  });

  test('a catch-all ".*" rewrite does not duplicate the title (QuinnQuinn bug)', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Schoolfotografie' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'regex', value: '.*' }, rewrite: 'Quinn' }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Quinn'], 'a single non-global replace should produce "Quinn", never "QuinnQuinn"');
  });

  test('the "any" match type is the intended way to write a catch-all rule', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Schoolfotografie' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Quinn' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Quinn' }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Schoolfotografie'], 'an "any" match changed the title');
    assertEqual(r.data.legend.map((p) => p.name), ['Quinn']);
  });

  test('title replaces the whole title, not just the matched substring', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class with Jane' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'L6' }, title: 'Swimming' }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Swimming']);
  });

  test('rewrite supports regex backreferences against the match', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Sprint 26-08' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'regex', value: 'Sprint (\\d+-\\d+)' }, rewrite: 'Sprint #$1' }] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Sprint #26-08']);
  });

  test('a rule routing a title and a rule rewriting it both apply', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'L6 Swim Class' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Alex' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [
        { match: { type: 'word', value: 'L6' }, line: 'Alex' },
        { match: { type: 'word', value: 'L6' }, rewrite: 'Lesson 6' },
      ] }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Lesson 6 Swim Class']);
  });

  test('a global rule assigns a track across every calendar, not just one', async () => {
    const fetchImpl = async (url) => okText(icsWithEvents([{
      start: '20260907T140000Z', end: '20260907T150000Z',
      summary: url.includes('a.ics') ? 'Doctor Appointment' : 'Something Else',
    }]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      rules: [{ match: { type: 'word', value: 'Doctor' }, line: 'Mom' }],
      lines: [{ name: 'Mom', badge: 'M' }],
      calendars: [{ url: 'https://example.com/a.ics' }, { url: 'https://example.com/b.ics' }],
    })));
    const doctorEvent = eventItems(r.data).find((e) => e.title.indexOf('Mom') !== -1 || e.title.indexOf('Doctor') !== -1);
    assert(!!doctorEvent, 'the global rule should have assigned Mom regardless of which calendar the event came from');
  });

  test('a calendar\'s own rule overrides a global rule\'s track assignment for the same event', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Doctor Appointment' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      rules: [{ match: { type: 'word', value: 'Doctor' }, line: 'Mom' }],
      lines: [{ name: 'Mom', badge: 'M' }, { name: 'Dad', badge: 'D' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Doctor' }, line: 'Dad' }] }],
    })));
    const ev0 = eventItems(r.data)[0];
    const dadTrack = r.data.legend.find((p) => p.name === 'Dad');
    assertEqual(ev0.owner, dadTrack.key, 'the calendar-specific rule should win over the global one');
  });

  test('a calendar\'s custom headers are sent on its ICS fetch, alongside the default User-Agent', async () => {
    let capturedHeaders = null;
    const fetchImpl = async (url, opts) => { capturedHeaders = opts && opts.headers; return okText(icsWithEvents([])); };
    await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', headers: { Authorization: 'Bearer secret-token' } }],
    })));
    assertEqual(capturedHeaders.Authorization, 'Bearer secret-token');
    assertEqual(capturedHeaders['User-Agent'], 'TRMNL-Metro-Calendar', 'the default User-Agent should still be sent alongside it');
  });

  test('non-string values in a calendar\'s headers are dropped rather than sent as-is', async () => {
    let capturedHeaders = null;
    const fetchImpl = async (url, opts) => { capturedHeaders = opts && opts.headers; return okText(icsWithEvents([])); };
    await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', headers: { 'X-Ok': 'fine', 'X-Bad': { nested: true } } }],
    })));
    assertEqual(capturedHeaders['X-Ok'], 'fine');
    assertEqual('X-Bad' in capturedHeaders, false, 'a non-string header value should be dropped, not passed through');
  });

  test('the first track in tracks[] (everyoneTrack) claims any event no rule assigns a track to', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Unclaimed Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Everyone', badge: '★' }],
      calendars: [{ url: 'https://example.com/a.ics' }],
    })));
    assertEqual(eventItems(r.data).length, 1);
    assertEqual(r.data.legend.map((p) => p.name), ['Everyone']);
  });

  test('a calendar says whose it is with line; with lines declared, its name is only a label', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Extra turnen' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Familie', badge: '★' }, { name: 'Jules', badge: 'K' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'School', line: 'Jules' }],
    })));
    const ev0 = eventItems(r.data)[0];
    assertEqual(ev0.owner, r.data.legend.find((p) => p.name === 'Jules').key, 'the calendar\'s line did not claim its event');
    assert(!r.data.legend.some((p) => p.name === 'School'), 'the calendar\'s name became a line');
  });

  test('a rule\'s own track assignment still wins over the everyoneTrack fallback', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Alex event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Everyone', badge: '★' }, { name: 'Alex', badge: 'A' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'word', value: 'Alex' }, line: 'Alex' }] }],
    })));
    const ev0 = eventItems(r.data)[0];
    const alexTrack = r.data.legend.find((p) => p.name === 'Alex');
    assertEqual(ev0.owner, alexTrack.key);
  });

  test('a rule with a multi-name track list produces an event with co_owners (an interchange, client-side)', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Family Dinner' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: ['Alex', 'Kids'] }] }],
    })));
    const ev0 = eventItems(r.data)[0];
    assertEqual(ev0.owner, r.data.legend.find((p) => p.name === 'Alex').key, 'the first name becomes the primary owner');
    assertEqual(ev0.co_owners.length, 1, 'the remaining name(s) become co_owners');
  });

  test('string-shorthand calendar entries (a bare URL, not {url:...}) are accepted', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Everyone' }],
      calendars: ['https://example.com/a.ics'],
    })));
    assertEqual(eventItems(r.data).length, 1);
  });

  test('non-JSON config text falls back to a newline-separated URL list', async () => {
    const { parseConfig } = runTransform();
    const cfg = parseConfig('https://a.example.com/x.ics\nhttps://b.example.com/y.ics\n');
    assertEqual(cfg.calendars.map((c) => c.url), ['https://a.example.com/x.ics', 'https://b.example.com/y.ics']);
  });

  // WHY THE BOARD IS EMPTY, SAID ON IT. A header over nothing looked the
  // same whether the paste was broken, the feeds were down or the day was
  // quiet, and each wants something different done about it.
  test('an unreadable configuration says so on the board', async () => {
    const r = await runTransform(h.demoNet(null, async () => okText(icsWithEvents([]))), NOW)
      .run(baseInput(NOW, { config_json: '{ "calendars": [ { "url": "https://x/a.ics" ' }));
    assertEqual(r.data.legend.length, 0, 'the example was drawn over a broken configuration');
    assert(/could not be read/.test(r.data.board_notice || ''), 'no notice: ' + r.data.board_notice);
  });

  test('every calendar failing says which, even with the lines still drawn', async () => {
    const r = await runTransform(async () => fail(404), NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Sam' }], calendars: [{ url: 'https://example.com/work.ics', name: 'Work', line: 'Sam' }] })));
    assert(/None of the calendars could be read: Work/.test(r.data.board_notice || ''), 'no notice: ' + r.data.board_notice);
  });

  test('a board with calendars that answered and nothing on them says so, and a busy one says nothing', async () => {
    const quiet = await runTransform(async () => okText(icsWithEvents([])), NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics' }] })));
    assert(/Nothing on the calendars/.test(quiet.data.board_notice || ''), 'no notice on an empty board: ' + quiet.data.board_notice);
    const busy = await runTransform(async () => okText(icsWithEvents([{ start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Standup' }])), NOW)
      .run(baseInput(NOW, cfgWith({ calendars: [{ url: 'https://example.com/a.ics', name: 'Sam' }] })));
    assertEqual(busy.data.board_notice, null, 'a board with something on it carries a notice');
  });

  test('non-JSON config text with no non-blank lines also falls back to the demo', async () => {
    const r = await runTransform(h.demoNet(null, async () => okText(icsWithEvents([]))), NOW)
      .run(baseInput(NOW, { config_json: '   \n   \n' }));
    const names = r.data.legend.map((t) => t.name).sort();
    assertEqual(names, ['Bart', 'Homer', 'Lisa', 'Maggie', 'Marge'], 'the demo config was not picked up');
  });

  test('a line nobody uses today is still on the board, because somebody named it', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Busy track only' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Idle' }, { name: 'Busy' }],
      calendars: [{ url: 'https://example.com/a.ics', rules: [{ match: { type: 'any' }, line: 'Busy' }] }],
    })));
    assertEqual(r.data.legend.map((p) => p.name).sort(), ['Busy', 'Idle'],
      'a board that deletes whoever is quiet changes shape every day');
  });

  test('hideWhenEmpty drops a line, and the lines left close up with no gap left behind', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'C event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      version: 1,
      lines: [{ name: 'A', hideWhenEmpty: true }, { name: 'B', hideWhenEmpty: true }, { name: 'C' }],
      calendars: [{ url: 'https://example.com/a.ics', line: 'C' }],
    })));
    assertEqual(r.data.legend.map((l) => l.name), ['C']);
    assertEqual(Math.abs(h.arranged(r.data)[0].line_offset), 10, 'C does not sit in the first slot, as if A and B left a gap');
  });

  test('side and color are gone: a configuration that still says them is drawn by the board\'s own choice', async () => {
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'C event' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const plain = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({ lines: [{ name: 'C' }], calendars: [{ url: 'https://example.com/a.ics', name: 'C' }] })));
    const pinned = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({ lines: [{ name: 'C', side: 'right', color: 'red' }], calendars: [{ url: 'https://example.com/a.ics', name: 'C' }] })));
    assertEqual(JSON.stringify(pinned.data.legend), JSON.stringify(plain.data.legend), 'side or color still changes the line');
  });


  // `tracks`/`track` are the current field names (tracks were called
  // "people" before this rename); a config written before the rename,
  // still sitting pasted into someone's live device, must keep working
  // exactly as before with zero edits.

  test('a long block carries its location and earns its owner a legend entry', async () => {
    // Eleven hours at a desk. This used to need `siding: true` in the
    // config and came back in a `sidings` array of its own; it is an
    // ordinary event now, and nothing about it is declared anywhere. What
    // is worth holding on to is that it is still a whole event: the
    // location is what the caption says where, and a track whose only
    // entry today is a block like this one still counts as active, so it
    // gets a line and a name.
    const ev = { start: '20260907T080000Z', end: '20260907T190000Z', summary: 'Desk booking', location: 'BE-Ghent A01' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Quinn' }],
    })));
    const items = eventItems(r.data);
    assertEqual(items.length, 1, 'a long block belongs on the timeline like anything else');
    assertEqual(items[0].title, 'Desk booking');
    assertEqual(items[0].location, 'BE-Ghent A01');
    assertEqual(items[0].start_min, 8 * 60);
    assertEqual(items[0].end_min, 19 * 60);
    const wardTrack = r.data.legend.find((p) => p.name === 'Quinn');
    assertEqual(items[0].owner, wardTrack.key, 'a track carrying only a long block is still "active"');
  });

  test('an all-day event is declared at the line\'s head, never on the axis', async () => {
    // It was an item spanning the visible window, which made the board
    // print its own window back as the event's hours -- "6am - 11pm /
    // Staff Training Day", which is not when the training is, it is when
    // the board decided to start looking. An all-day event has no hour to
    // show, so it gets no place on a scale of hours.
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Staff Training Day' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Training' }, allDay: true }] }],
    })));
    assertEqual(eventItems(r.data), [], 'nothing between the first hour and the last');
    assertEqual(r.data.sidings, undefined, 'and not split into a payload of its own either');
    assertEqual(r.data.all_day.length, 1, 'it is declared once');
    const st = r.data.all_day[0];
    assertEqual(st.title, 'Staff Training Day');
    const calTrack = r.data.legend.find((p) => p.name === 'Cal');
    assertEqual(st.owners, [calTrack.key], 'against the line whose day it is');
    assertEqual(st.hue, undefined, 'presentation is the frontend\'s');
  });

  test('one all-day title shared by several lines is one origin, named once', async () => {
    // Three people are not on three holidays; they are on one. Naming it
    // per line would put the same words at three heads and say there were
    // three of them.
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Half Term' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [
        { url: 'https://example.com/a.ics', name: 'Cal', rules: [{ match: { type: 'word', value: 'Half' }, allDay: true }] },
        { url: 'https://example.com/b.ics', name: 'Two', rules: [{ match: { type: 'word', value: 'Half' }, allDay: true }] },
      ],
    })));
    assertEqual(r.data.all_day.length, 1, 'one row, not one per line');
    assertEqual(r.data.all_day[0].owners.length, 2, 'carrying both lines');
  });

  test('one rule naming several lines puts the all-day entry on all of them', async () => {
    // A school holiday feed routed to all four children. This used to keep
    // `lineNames[0]` and throw the rest away: whichever child happened to
    // be first in the list was off school and the other three had an
    // ordinary day. A timed event routed to several lines has been an
    // interchange all along; this is that, at the head of the line.
    const ev = { start: '20260907T140000Z', end: '20260907T150000Z', summary: 'Spring Break' };
    const fetchImpl = async () => okText(icsWithEvents([ev]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Ada' }, { name: 'Bo' }, { name: 'Cy' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'School', rules: [
        { match: { type: 'word', value: 'Spring' }, allDay: true, line: ['Ada', 'Bo', 'Cy'] },
      ] }],
    })));
    assertEqual(r.data.all_day.length, 1, 'one row, not one per line');
    const names = {};
    r.data.legend.forEach((l) => { names[l.key] = l.name; });
    assertEqual(r.data.all_day[0].owners.map((k) => names[k]).sort(), ['Ada', 'Bo', 'Cy'],
      'three children are on one holiday, and all three are on it');
  });

  test('a real meeting inside a long block\'s span still renders normally alongside it', async () => {
    // A standup at nine while somebody is at a desk from eight to seven.
    // Both are events, they overlap, and neither swallows the other: the
    // long one used to be filtered off the timeline, and the fear on the
    // other side of that was that the short one would go with it.
    const evLong = { start: '20260907T080000Z', end: '20260907T190000Z', summary: 'Desk booking' };
    const evMeeting = { start: '20260907T090000Z', end: '20260907T093000Z', summary: 'Standup' };
    const fetchImpl = async () => okText(icsWithEvents([evLong, evMeeting]));
    const r = await runTransform(fetchImpl, NOW).run(baseInput(NOW, cfgWith({
      calendars: [{ url: 'https://example.com/a.ics', name: 'Quinn' }],
    })));
    assertEqual(eventItems(r.data).map((e) => e.title), ['Desk booking', 'Standup'],
      'in start order, both on the timeline');
  });
  // ---- WHO CLAIMS A CALENDAR NOBODY ROUTED --------------------------------
  //
  // A calendar with no rules and no name used to go to the FIRST entry in
  // `lines[]`. The variable holding it is called `everyoneLine`, which is
  // the giveaway: it was written to mean "everyone" and it meant "whoever
  // happens to be first".
  //
  // The calendar this actually describes is the household one -- the bin
  // day, the holidays, the shared family feed pasted in without saying whose
  // it is. Giving it to the first person is a confident wrong answer and a
  // silent one: it shows up as that person's day and nothing says otherwise.
  test('a calendar nobody routed belongs to the whole household', async () => {
    const ev = { start: '20260907T180000Z', end: '20260907T190000Z', summary: 'Bin Day' };
    const { run } = runTransform(async () => okText(icsWithEvents([ev])), NOW);
    const r = await run(baseInput(NOW, cfgWith({
      lines: [{ name: 'Ada' }, { name: 'Bo' }, { name: 'Cy' }],
      calendars: [{ url: 'https://example.com/shared.ics' }],
    })));
    const bin = eventItems(r.data).filter((e) => e.title === 'Bin Day')[0];
    assert(bin, 'the unrouted calendar produced no event at all');
    const on = [bin.owner].concat(bin.co_owners || []).sort();
    const key = {};
    r.data.legend.forEach((t) => { key[t.key] = t.name; });
    assertEqual(on.map((k) => key[k]).sort(), ['Ada', 'Bo', 'Cy'],
      'an unrouted calendar landed on ' + on.map((k) => key[k]).join(', ') + ' rather than everyone');
  });



  // THE BADGES ARE GONE, AND SO ARE THE CARS THEY NAMED.
  //
  // Three cases lived here: an emoji badge surviving its surrogate pair, two
  // names starting alike getting different letters, and an asked-for badge
  // never being rewritten. All three were about the letter drawn inside a
  // car -- the little train standing at the current minute -- and the board
  // does not draw cars any more, so there is no letter to be right about.
  // The configured `badge` went with them; CONFIG.md no longer lists it.
};
