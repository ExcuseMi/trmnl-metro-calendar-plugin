'use strict';

// A configuration usually arrives here by being copied out of somewhere
// else: a chat window, a code block on a web page, an editor that helpfully
// straightens quotes. Every one of those leaves marks on the text, and
// strict JSON refuses all of them. The setting box is the only way in, so
// the parser has to read what people actually paste, not what a JSON file
// would have looked like.

module.exports = function (test, h) {
  const { runTransform, icsWithEvents, okText, fail, baseInput, eventItems, assert, assertEqual } = h;

  const NOW = Date.parse('2026-09-09T09:00:00Z');
  const URL = 'https://cal.example.com/crew.ics';
  const ics = icsWithEvents([{ summary: 'Standup', start: '20260909T090000Z', end: '20260909T091500Z' }]);
  const serve = async (url) => (String(url) === URL ? okText(ics) : fail(404));

  const CONFIG = {
    lines: [{ name: 'Fry' }, { name: 'Leela' }],
    calendars: [{ url: URL, name: 'Crew', rules: [{ match: { type: 'contains', value: 'Fry:' }, line: 'Fry' }] }],
  };
  const PRETTY = JSON.stringify(CONFIG, null, 1);

  function parse(raw) {
    const { parseConfig } = runTransform(serve, NOW);
    return parseConfig(raw);
  }
  // what the config actually says, in the terms the rest of the pipeline
  // reads it in: two lines, one feed, one routing rule
  function shape(cfg) {
    return Object.keys(cfg.lines).map((k) => cfg.lines[k].name).join(',') + ' | '
      + cfg.calendars.map((c) => c.name + '@' + c.url + ':' + c.rules.length).join(',');
  }
  const WANT = shape(parse(PRETTY));

  test('a configuration pasted as plain JSON reads, as it always did', () => {
    assertEqual(WANT, 'Fry,Leela | Crew@' + URL + ':1', 'the fixture itself does not parse');
  });

  // The one that sent us here. A chat client that escapes its answer for
  // markdown writes every bracket as \[ and \], and ends every line with a
  // backslash. None of that is JSON, and all of it is on the clipboard.
  test('a configuration escaped for markdown still reads', () => {
    const escaped = PRETTY
      .replace(/([[\]{}])/g, '\\$1')
      .split('\n').join('\\\n');
    assert(escaped.indexOf('\\[') >= 0, 'the fixture is not actually escaped');
    assertEqual(shape(parse(escaped)), WANT, 'markdown escaping ate the configuration');
  });

  test('a configuration still wrapped in its code fence reads', () => {
    assertEqual(shape(parse('```json\n' + PRETTY + '\n```')), WANT, 'the fence ate the configuration');
    // and with the assistant talking either side of it
    assertEqual(shape(parse('Here you go:\n\n```json\n' + PRETTY + '\n```\n\nPaste that in.')), WANT,
      'a fenced block in the middle of a reply was not found');
  });

  test('quotes an editor straightened, and a trailing comma, still read', () => {
    const curly = PRETTY.replace(/"/g, (m, i) => (i % 2 ? '”' : '“'));
    assertEqual(shape(parse(curly)), WANT, 'typographic quotes ate the configuration');
    assertEqual(shape(parse(PRETTY.replace(/\}\n\s*\]\n\}$/, '},\n ]\n}'))), WANT,
      'a trailing comma ate the configuration');
    assertEqual(shape(parse(PRETTY.replace(/ /g, ' ').replace(/ "/g, ' "'))), WANT,
      'non-breaking spaces ate the configuration');
  });

  // A backslash IS legal in JSON, inside a string, and a regex rule is
  // nothing but backslashes. Un-escaping markdown must not touch those.
  test('a regex rule survives the tidying', () => {
    const withRegex = JSON.stringify({
      calendars: [{ url: URL, name: 'Crew', rules: [{ match: { type: 'regex', value: '^\\d+ ' }, line: 'Fry' }] }],
    }, null, 1);
    const cfg = parse(withRegex.replace(/([[\]])/g, '\\$1'));
    assertEqual(cfg.calendars.length, 1, 'the escaped config did not parse at all');
    assertEqual(cfg.calendars[0].rules.length, 1, 'the regex rule was lost');
  });

  test('a plain list of links is still a plain list of links', () => {
    const cfg = parse('https://a.example/x.ics\nwebcal://b.example/y.ics\n');
    assertEqual(cfg.calendars.map((c) => c.url),
      ['https://a.example/x.ics', 'webcal://b.example/y.ics'], 'the simple setup broke');
  });

  // Text that opens with a brace meant to be a configuration. Reading its
  // lines as URLs finds no URLs and draws a board of nothing, which looks
  // like the plugin is broken rather than like the config is. Nothing
  // usable means nothing usable, and the caller falls back to the demo.
  test('a configuration too broken to read is not mistaken for a list of links', () => {
    const cfg = parse('{ "calendars": [ { "url": "' + URL + '" oops ] }');
    assertEqual(cfg.calendars.length, 0, 'a broken configuration was read as URLs');
  });

  test('a board builds from a configuration that arrived escaped', async () => {
    const { run } = runTransform(serve, NOW);
    const escaped = JSON.stringify({
      lines: [{ name: 'Fry' }],
      calendars: [{ url: URL, name: 'Fry', rules: [{ match: { type: 'any' }, line: 'Fry' }] }],
    }, null, 1).replace(/([[\]])/g, '\\$1');
    const r = await run(baseInput(NOW, { use_demo_data: 'false', config_json: escaped }));
    assertEqual(r.data.legend.map((t) => t.name), ['Fry'], 'the board is not the one the config asked for');
    assertEqual(eventItems(r.data).map((i) => i.title), ['Standup'], 'the events did not arrive');
  });
};
