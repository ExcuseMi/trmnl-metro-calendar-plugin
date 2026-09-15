// THE MOON IS A FACT ABOUT THE DATE, so each day row carries its phase as a
// lit fraction and the board draws it in the dark hours. Checked against the phases
// of September 2026: new on the 11th, first quarter on the 18th, full on the
// 26th.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, baseInput, assert } = h;

  async function daysOn(iso) {
    const now = Date.parse(iso);
    const { run } = runTransform(async () => okText(icsWithEvents([
      { start: iso.replace(/[-:]/g, '').slice(0, 9) + '180000Z', end: iso.replace(/[-:]/g, '').slice(0, 9) + '190000Z', summary: 'Dinner' },
    ])), now);
    const r = await run(baseInput(now, { config_json: 'https://calendar.example.com/a.ics' }));
    return r.data.days || [];
  }

  test('each day carries the moon it has that night', async () => {
    for (const [iso, lo, hi, waxing] of [['2026-09-11T09:00:00Z', 0, 3, null], ['2026-09-18T09:00:00Z', 40, 60, true],
                                         ['2026-09-26T09:00:00Z', 97, 100, null], ['2026-10-03T09:00:00Z', 40, 60, false]]) {
      const days = await daysOn(iso);
      const m = days[0] && days[0].moon;
      assert(m && typeof m.illumination === 'number', iso + ': no moon on the day row');
      assert(m.illumination >= lo && m.illumination <= hi, iso + ': ' + m.illumination + '% lit, expected ' + lo + '..' + hi);
      if (waxing != null) assert(m.waxing === waxing, iso + ': waxing is ' + m.waxing);
    }
  });

  test('Moon Phase switched off leaves every day without one', async () => {
    const now = Date.parse('2026-09-26T20:00:00Z');
    const { run } = runTransform(async () => okText(icsWithEvents([])), now);
    const r = await run(baseInput(now, { config_json: 'https://calendar.example.com/a.ics', show_moon: 'false' }));
    assert((r.data.days || []).length && r.data.days.every((d) => d.moon == null), 'a moon was sent anyway');
  });
};
