const fs = require('fs');
const path = require('path');
module.exports = function (test, h) {
  const { loadEditor, click, jsonOut, assert, assertEqual } = h;
  const demo = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../demo-config.json'), 'utf-8'));

  test('the demo configuration round-trips through the editor', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify(demo);
    click(document.getElementById('loadImport'));
    const out = jsonOut(document);
    assertEqual(out.lines, demo.lines);
    assertEqual(out.calendars, demo.calendars);
    assertEqual(out.timeZone, demo.timeZone);
    assert(document.querySelectorAll('#lines .card').length === demo.lines.length);
  });

  test('what a configuration says that nothing reads is listed when it loads', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({ version: 1, lines: [{ name: 'Sam' }],
      calendars: [{ url: 'https://a.example/x.ics', line: 'Sma', hideIfEmpty: false, rules: [{ match: { type: 'wrod', value: 'x' }, hide: true }] }] });
    click(document.getElementById('loadImport'));
    const list = document.getElementById('importWarnings');
    assert(!list.hidden, 'nothing was listed');
    const text = list.textContent;
    for (const want of ['"hideIfEmpty"', '"Sma" is not in lines', '"wrod"']) assert(text.indexOf(want) >= 0, 'missing ' + want + ': ' + text);
    document.getElementById('importIn').value = JSON.stringify({ version: 1, lines: [{ name: 'Sam' }], calendars: [{ url: 'https://a.example/x.ics', line: 'Sam' }] });
    click(document.getElementById('loadImport'));
    assert(list.hidden, 'a clean configuration still shows warnings: ' + list.textContent);
  });

  test('a plain list of ICS links imports as bare calendars', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = 'https://a.example/x.ics\nwebcal://b.example/y.ics\n';
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).calendars, [{ url: 'https://a.example/x.ics' }, { url: 'webcal://b.example/y.ics' }]);
  });

  test('tracks named only in rules are added to the tracks list on import', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({ calendars: [{ url: 'https://a.example/x.ics', rules: [{ match: { type: 'word', value: 'Yoga' }, line: 'Alex' }] }] });
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).lines, [{ name: 'Alex' }]);
    assertEqual(jsonOut(document).calendars[0].rules, [{ match: { type: 'word', value: 'Yoga' }, line: 'Alex' }]);
  });

  test('the editor parses its own output with the plugin\'s parseConfig', () => {
    const { window, document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify(demo);
    click(document.getElementById('loadImport'));
    const parsed = window.parseConfig(document.getElementById('jsonOut').value);
    assert(parsed.calendars.length === demo.calendars.length);
    assert(Object.keys(parsed.lines).length === demo.lines.length);
    // Every rule the example writes has to survive the trip and still
    // compile. The two that used not to are the point: an empty `rewrite`
    // (delete the matched text -- how every class code on this board gets
    // stripped) exported as nothing at all, and `allDay` had nowhere to
    // live, so loading the example silently dropped both and the board came
    // back reading "L6 Maths".
    const wrote = demo.calendars.reduce((n, c) => n + (c.rules || []).length, 0);
    const kept = parsed.calendars.reduce((n, c) => n + (c.rules || []).length, 0);
    assert(kept === wrote, kept + ' of ' + wrote + ' rules survived the editor');
    const out = JSON.parse(document.getElementById('jsonOut').value);
    const all = out.calendars.reduce((a, c) => a.concat(c.rules || []), []);
    assert(all.some((r) => r.rewrite === ''), 'the strip rules were dropped');
  });


  // A TOOL MUST NOT QUIETLY CHANGE A SETTING IT DOES NOT SHOW.
  //
  // There is no control on this page for the clock or the temperature unit,
  // and there should not be: they are decided once for the whole board. But
  // every shipped demo config carries `"timeFormat": "12h"`, so importing
  // one and pasting the result back flipped the clock to 24h with nothing
  // said. Line-level `hideIfEmpty` went the same way -- documented, read by
  // the plugin, and dropped here.
  test('settings the page cannot edit still survive a trip through it', () => {
    const { document } = loadEditor();
    const cfg = {
      timeFormat: '12h', temperatureUnit: 'f', timeZone: 'Europe/Brussels', locale: 'en',
      lines: [{ name: 'Sam', hideWhenEmpty: true }, { name: 'Alex' }],
      calendars: [{ url: 'https://a.example/s.ics', name: 'Sam', line: 'Sam' }],
    };
    document.getElementById('importIn').value = JSON.stringify(cfg);
    click(document.getElementById('loadImport'));
    const out = jsonOut(document);
    assertEqual(out.timeFormat, '12h', 'the clock setting was eaten');
    assertEqual(out.temperatureUnit, 'f', 'the temperature unit was eaten');
    assertEqual(out.timeZone, 'Europe/Brussels');
    assertEqual(out.lines[0], { name: 'Sam', hideWhenEmpty: true }, 'a line that should drop on an empty day lost that');
    assertEqual(out.lines[1], { name: 'Alex' }, 'a plain line grew a key');
  });

  test('an old config\'s "siding" rule imports without it, and without breaking', () => {
    // `siding` (and the `station` it shipped as) used to be a rule option
    // and is not one any more: a long block is a long block because it is
    // long, which the layout reads off the clock. A config saved back then
    // is still a config -- it loads, the key is dropped the way any
    // unrecognised key is, and the rule keeps whatever else it asked for.
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Quinn' }],
      calendars: [{ url: 'https://a.example/x.ics', rules: [
        { match: { type: 'word', value: 'Desk booking' }, siding: true, line: 'Quinn' },
      ] }],
    });
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).calendars[0].rules,
      [{ match: { type: 'word', value: 'Desk booking' }, line: 'Quinn' }]);
  });

  test('importing keepLine round-trips and ticks the keep-line box', () => {
    // the switch that keeps a quiet person's line on the board: it has to
    // survive a trip through the editor, or anyone who opens their config
    // there loses it without being told
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      calendars: [
        { name: 'Quiet', url: 'https://a.example/q.ics', keepLine: true },
        { name: 'Busy', url: 'https://a.example/b.ics' },
      ],
    });
    click(document.getElementById('loadImport'));
    const out = jsonOut(document).calendars;
    assertEqual(out[0].keepLine, true);
    assert(!('keepLine' in out[1]), 'the default should not be written out: ' + JSON.stringify(out[1]));
    const cards = document.querySelectorAll('#calendars .card');
    const boxOf = (card) => [...card.querySelectorAll('.adv-body label.check')].find((l) => /keep this line/.test(l.textContent)).querySelector('input');
    assert(boxOf(cards[0]).checked, 'the keep-empty box should be ticked for the imported calendar');
    assert(!boxOf(cards[1]).checked, 'the other calendar should be left alone');
  });
  // What comes back out of a chat window is not what went in: the answer is
  // wrapped in a code fence, every bracket escaped for markdown, every line
  // ended with a backslash. The box people paste into is the same box, so it
  // has to read that too. (The plugin's own parser does the same thing; the
  // two are tested apart because a config that only loads in the tool and
  // not on the device is worse than one that loads in neither.)
  test('a configuration copied out of a chat window imports', () => {
    const cfg = { lines: [{ name: 'Fry' }], calendars: [{ url: 'https://a.example/x.ics' }] };
    const pretty = JSON.stringify(cfg, null, 1);
    const mangled = 'Here you go:\n\n```json\n'
      + pretty.replace(/([[\]{}])/g, '\\$1').split('\n').join('\\\n')
      + '\n```\n\nPaste that into TRMNL.';
    const { document } = loadEditor();
    document.getElementById('importIn').value = mangled;
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).lines, cfg.lines, 'the tracks did not survive the paste');
    assertEqual(jsonOut(document).calendars, cfg.calendars, 'the calendars did not survive the paste');
  });

};
