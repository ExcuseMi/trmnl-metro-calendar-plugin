// THE CONFIGURATION FORMAT. Configurations are pasted into settings boxes and
// never edited again, so the format is pinned down here: what version 1 means,
// that the editor's shorter spelling of a calendar's owner draws the same
// board, and that the checker names what a configuration says that nothing
// reads.

const fs = require('fs');
const path = require('path');

module.exports = function (test, h) {
  const { runTransform, okText, fail, baseInput, eventItems, assert, assertEqual } = h;
  const NOW = Date.parse('2026-09-15T14:00:00Z');
  const ROOT = path.join(__dirname, '../../..');

  function icsOf(rows) {
    return ['BEGIN:VCALENDAR', 'VERSION:2.0'].concat(rows, ['END:VCALENDAR', '']).join('\r\n');
  }
  const FEED = icsOf([
    'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:L2 - Zwemmen', 'DTSTART;TZID=Europe/Brussels:20260915T090000', 'DTEND;TZID=Europe/Brussels:20260915T100000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:2@x', 'SUMMARY:Sportdag', 'DTSTART;TZID=Europe/Brussels:20260915T130000', 'DTEND;TZID=Europe/Brussels:20260915T140000', 'END:VEVENT',
  ]);
  async function payload(cfg, serve, now) {
    const t = now || NOW;
    const input = baseInput(t, { config_json: typeof cfg === 'string' ? cfg : JSON.stringify(cfg) });
    input.trmnl.user.time_zone_iana = 'Europe/Brussels';
    return (await runTransform(serve || (async () => okText(FEED)), t).run(input)).data;
  }
  const byLine = (d) => {
    const nm = {}; (d.legend || []).forEach((l) => { nm[l.key] = l.name; });
    return eventItems(d).map((e) => [e.title, [e.owner].concat(e.co_owners || []).map((k) => nm[k]).sort().join('+')].join(' @ ')).sort();
  };

  test('the format: a calendar says whose it is with line, and a rule naming a line leaves the title alone', async () => {
    const d = await payload({ version: 1, lines: [{ name: 'Mia' }, { name: 'Noah' }],
      calendars: [{ url: 'https://example.com/school.ics', name: 'School', line: ['Mia', 'Noah'],
        rules: [{ match: { type: 'word', value: 'L2' }, line: 'Mia' }] }] });
    assertEqual(byLine(d), ['L2 - Zwemmen @ Mia', 'Sportdag @ Mia+Noah']);
    assertEqual((d.legend || []).map((l) => l.name).sort(), ['Mia', 'Noah'], 'the calendar\'s name became a line');
  });

  test('the format: title replaces the whole title, rewrite cuts, and name is a line only without lines', async () => {
    const d = await payload({ version: 1, calendars: [{ url: 'https://example.com/school.ics', name: 'School',
      rules: [{ match: { type: 'regex', value: '^L\\d\\s*-\\s*' }, rewrite: '' }, { match: { type: 'contains', value: 'Sport' }, title: 'Sports day' }] }] });
    assertEqual(byLine(d), ['Sports day @ School', 'Zwemmen @ School']);
  });

  test('a not written with matchers is read as none of them, not dropped', async () => {
    const d = await payload({ version: 1, lines: [{ name: 'Mia' }], calendars: [{ url: 'https://example.com/school.ics', line: 'Mia',
      rules: [{ match: { type: 'not', matchers: [{ type: 'contains', value: 'Zwemmen' }] }, hide: true }] }] });
    assertEqual(byLine(d), ['L2 - Zwemmen @ Mia']);
  });

  // Every version 1 configuration this repository has, with the feeds it
  // draws from, migrated the way the editor migrates (hoisting the owner
  // rule into `line`) and as the plugin reads it.
  const households = fs.readdirSync(path.join(ROOT, 'test/households')).filter((n) => fs.existsSync(path.join(ROOT, 'test/households', n, 'config.json')));
  for (const name of households) {
    test('a household draws the same board with its owner rules said as line: ' + name, async () => {
      const dir = path.join(ROOT, 'test/households', name);
      const v1 = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));
      delete v1.version;
      const serve = async (url) => {
        const f = path.join(dir, decodeURIComponent(String(url).split('?')[0].split('/').pop()));
        return /\.ics$/.test(f) && fs.existsSync(f) ? okText(fs.readFileSync(f, 'utf-8')) : fail(404);
      };
      const { migrateConfig } = runTransform(serve, NOW);
      const v2 = JSON.parse(JSON.stringify(migrateConfig(v1, true)));
      assertEqual(v2.version, 1);
      for (const at of [NOW, NOW + 18 * 3600e3]) {
        const a = await payload(v1, serve, at), b = await payload(v2, serve, at);
        assertEqual(byLine(b), byLine(a), 'the migrated configuration draws different events');
        assertEqual((b.all_day || []).map((x) => x.title).sort(), (a.all_day || []).map((x) => x.title).sort(), 'the all-day entries differ');
        assertEqual((b.legend || []).map((l) => l.name), (a.legend || []).map((l) => l.name), 'the lines differ');
      }
    });
  }

  for (const name of ['simpsons', 'futurama', 'friends']) {
    test('a demo draws the same board with its owner rules said as line: ' + name, async () => {
      const v1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', name, 'config.json'), 'utf-8'));
      delete v1.version;
      const serve = h.demoNet();
      const { migrateConfig } = runTransform(serve, NOW);
      const v2 = migrateConfig(v1, true);
      for (const at of [NOW, NOW - 6 * 3600e3]) {
        const a = await payload(v1, serve, at), b = await payload(v2, serve, at);
        assert(byLine(a).length > 0, 'the demo drew nothing, so this proves nothing');
        assertEqual(byLine(b), byLine(a), 'the migrated demo draws different events');
        assertEqual((b.legend || []).map((l) => l.name), (a.legend || []).map((l) => l.name), 'the lines differ');
      }
    });
  }

  test('the checker names keys nothing reads, unknown matches, bad patterns and lines that are not declared', () => {
    const { configWarnings } = runTransform(async () => fail(404), NOW);
    const w = configWarnings({ version: 1, lines: [{ name: 'Mia' }], calender: [],
      calendars: [{ url: 'https://x/a.ics', lines: 'Mia', line: 'Miao',
        rules: [{ match: { type: 'wrod', value: 'x' }, hide: true }, { match: { type: 'regex', value: '(' }, hide: true }, { match: { type: 'any' }, line: 'Mia', rename: false }] }] });
    const all = w.join('\n');
    for (const want of ['"calender"', '"lines" is not a setting', '"Miao" is not in lines', '"wrod" is not a kind of match', 'not a valid regular expression', '"rename" is not a setting']) {
      assert(all.indexOf(want) >= 0, 'the checker missed ' + want + ':\n' + all);
    }
    assertEqual(configWarnings({ version: 1, lines: [{ name: 'Mia' }], calendars: [{ url: 'https://x/a.ics', line: 'Mia' }] }), [], 'a clean configuration has warnings');
  });
};
