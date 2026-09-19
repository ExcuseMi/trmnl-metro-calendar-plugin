'use strict';

// A PERSON KEEPS THEIR STYLE. The page hands out textures and shades down a
// ladder by the legend's order, and the order moves with the day (Order.
// arrange, who was dropped, which feed answered first). Each person is given
// a rung once, kept in the saved state by name, and keeps it: "as long the
// tracks didn't change, reuse the once assigned track styles".

module.exports = function (test, h) {
  const { runTransform, okText, baseInput, assert, assertEqual } = h;
  const NOW = Date.parse('2026-09-19T10:00:00Z');
  const ICS = (summary, hm) => 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:' + summary + '\r\n'
    + 'DTSTART:20260919T' + hm + '00Z\r\nDTEND:20260919T' + hm + '30Z\r\nSUMMARY:' + summary + '\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const feeds = {
    'https://x.example/a.ics': ICS('Alpha', '1200'), 'https://x.example/b.ics': ICS('Bravo', '0900'),
    'https://x.example/c.ics': ICS('Charlie', '1500'), 'https://x.example/d.ics': ICS('Delta', '1800'),
  };
  const net = async (url) => okText(feeds[String(url)] || 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  const cfg = (names) => JSON.stringify({ version: 1,
    lines: names.map((n) => ({ name: n })),
    calendars: names.map((n) => ({ url: 'https://x.example/' + n.charAt(0).toLowerCase() + '.ics', line: n })) });
  // (keys in name order, so the comparison is about the rungs and not about
  // the order the legend happened to arrive in)
  const slotsOf = (r) => { const o = {}; (r.data.legend || []).map((l) => [l.name, l.slot]).sort().forEach(([n, s]) => { o[n] = s; }); return o; };

  test('every person gets a rung, in the legend\'s order the first time, and it is saved', async () => {
    const { run } = runTransform(net, NOW);
    const r = await run(baseInput(NOW, { config_json: cfg(['Alpha', 'Bravo', 'Charlie']) }));
    assertEqual(slotsOf(r), { Alpha: 0, Bravo: 1, Charlie: 2 });
    assertEqual(r.trmnl_state.lineSlots, { Alpha: 0, Bravo: 1, Charlie: 2 });
  });

  test('the rungs come back from the state whatever order the legend arrives in', async () => {
    const { run } = runTransform(net, NOW);
    const input = baseInput(NOW, { config_json: cfg(['Charlie', 'Alpha', 'Bravo']) });
    input.trmnl.state = { lineSlots: { Alpha: 0, Bravo: 1, Charlie: 2 } };
    const r = await run(input);
    assertEqual(slotsOf(r), { Alpha: 0, Bravo: 1, Charlie: 2 });
  });

  test('somebody new takes the lowest free rung; somebody gone frees theirs', async () => {
    const { run } = runTransform(net, NOW);
    const input = baseInput(NOW, { config_json: cfg(['Alpha', 'Charlie', 'Delta']) });
    input.trmnl.state = { lineSlots: { Alpha: 0, Bravo: 1, Charlie: 2 } };
    const r = await run(input);
    assertEqual(slotsOf(r), { Alpha: 0, Charlie: 2, Delta: 1 });
    assertEqual(r.trmnl_state.lineSlots, { Alpha: 0, Charlie: 2, Delta: 1 });
  });

  test('a shared calendar\'s line takes no rung', async () => {
    const { run } = runTransform(net, NOW);
    const shared = JSON.stringify({ version: 1, lines: [{ name: 'Alpha' }, { name: 'Bravo' }],
      calendars: [{ url: 'https://x.example/a.ics', line: 'Alpha' }, { url: 'https://x.example/b.ics', line: 'Bravo' },
                  { url: 'https://x.example/c.ics', name: 'Family' }] });
    const r = await run(baseInput(NOW, { config_json: shared }));
    const s = slotsOf(r);
    assertEqual(s.Alpha, 0); assertEqual(s.Bravo, 1);
    assert(s.Family == null, 'the shared line took a rung: ' + s.Family);
  });

  test('junk in the saved rungs is dropped, not replayed', async () => {
    const { run } = runTransform(net, NOW);
    const input = baseInput(NOW, { config_json: cfg(['Alpha', 'Bravo']) });
    input.trmnl.state = { lineSlots: { Alpha: 'x', Bravo: -3, '': 2 } };
    const r = await run(input);
    assertEqual(slotsOf(r), { Alpha: 0, Bravo: 1 });
  });
};
