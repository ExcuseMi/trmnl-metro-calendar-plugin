'use strict';

// THE SAME FEEDS, THE SAME BOARD, WHICHEVER ANSWERS FIRST.
//
// The feeds are fetched together, and each one's events used to be put on
// the board as its answer arrived; the list was then sorted by start minute
// alone. So two events in the same minute came out in whichever order the
// network answered -- and so did the lines themselves, which are registered
// as their first event is read. Found by comparing the squeezed transform
// with the source on the demo: same input, same code, a different payload.
// These answer the feeds in both orders and ask for one answer.

require('../lib/transform').cases('order', function (test, h) {
  const { runTransform, baseInput, icsWithEvents, serve, status, FORECAST, I18N, assertEqual } = h;
  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const A = 'https://a.example.com/a.ics', B = 'https://b.example.com/b.ics', C = 'https://c.example.com/c.ics';
  const at = (title) => icsWithEvents([{ start: '20260909T140000Z', end: '20260909T150000Z', summary: title }]);
  const input = () => baseInput(NOW, { config_json: JSON.stringify({ calendars: [
    { url: A, name: 'Ann' }, { url: B, name: 'Ben' }, { url: C, name: 'Cy' }] }) });
  // `slow` answers 400ms late, the rest at once
  const net = (slow) => [status(FORECAST, 503), status(I18N, 404)].concat([[A, 'Dentist'], [B, 'Swim'], [C, 'Piano']]
    .map(([u, t]) => serve(u, at(t), u === slow ? { delayMs: 400 } : {})));

  test('events in the same minute, and the lines, come out in the order the config names the calendars', async () => {
    const runs = [];
    for (const slow of [A, B, C]) runs.push(await runTransform(net(slow), NOW).run(input()));
    const shape = (r) => ({ events: r.data.events.map((e) => [e.title, e.owner, e.start_min]),
      legend: r.data.legend.map((l) => [l.key, l.name]) });
    assertEqual(shape(runs[0]).events.map((e) => e[0]), ['Dentist', 'Swim', 'Piano'], 'the order of the config');
    assertEqual(shape(runs[1]), shape(runs[0]), 'with the second feed answering last');
    assertEqual(shape(runs[2]), shape(runs[0]), 'with the third feed answering last');
  });
});
