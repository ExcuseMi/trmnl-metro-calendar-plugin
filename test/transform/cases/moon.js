'use strict';

// TONIGHT'S MOON (rule 2n): every day row carries the night's lit fraction
// and whether it is growing, counted offline, for the moon the board draws
// under the time line. September 2026 has its new moon on the 11th and its
// full moon on the 26th.

module.exports = function (test, h) {
  const { runTransform, okText, baseInput, assert } = h;
  const net = async () => okText('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  const cfg = JSON.stringify({ version: 1, lines: [{ name: 'Alpha' }],
    calendars: [{ url: 'https://x.example/a.ics', line: 'Alpha' }] });
  async function moonOn(iso) {
    const now = Date.parse(iso + 'T10:00:00Z');
    const { run } = runTransform(net, now);
    const r = await run(baseInput(now, { config_json: cfg }));
    return (r.data.days || []).map((d) => d.moon);
  }

  test('each day carries its night\'s moon, lit and growing as the sky has it', async () => {
    const newMoon = await moonOn('2026-09-11');
    assert(newMoon[0] && newMoon[0].illumination <= 3, 'the new moon: ' + JSON.stringify(newMoon[0]));
    const full = await moonOn('2026-09-26');
    assert(full[0] && full[0].illumination >= 97, 'the full moon: ' + JSON.stringify(full[0]));
    const waxing = await moonOn('2026-09-19');
    assert(waxing[0].waxing === true && waxing[0].illumination > 30 && waxing[0].illumination < 80, 'a waxing moon: ' + JSON.stringify(waxing[0]));
    assert(waxing[1] && waxing[1].illumination > waxing[0].illumination, 'tomorrow\'s moon is not fuller');
    const waning = await moonOn('2026-10-02');
    assert(waning[0].waxing === false, 'a waning moon: ' + JSON.stringify(waning[0]));
  });
};
