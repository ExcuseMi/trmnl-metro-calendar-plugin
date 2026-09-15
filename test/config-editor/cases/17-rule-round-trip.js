'use strict';

// A COMMA MEANS TWO DIFFERENT THINGS, AND ONLY ONE OF THEM IS A LIST.
//
// The value box takes "Dentist, Piano" and compiles it to an "or" of both
// words, which is the plain-language way to write "any of these". A regex
// was run through the same splitter, and a comma in a regex is a
// quantifier: "^L[0-9]{1,2}" came out as the two patterns "^L[0-9]{1" and
// "2}", the first of which does not compile at all -- the plugin drops a
// matcher it cannot compile -- and the second of which matches the literal
// text "2}". Nothing said so. The rule sat there in the editor reading like
// a regex and routed nothing.

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, fireChange, checkByLabel, jsonOut, assert, assertEqual } = h;

  const PATTERN = '^L[0-9]{1,2}\\b';

  test('a regex keeps its commas, because they are quantifiers and not a list', () => {
    const { window, document } = loadEditor();
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireChange(rule.querySelector('.cond-type'), 'regex');
    fireInput(rule.querySelector('.cond-value'), PATTERN);
    const hide = checkByLabel(rule, 'hide it from the map');
    hide.checked = true; fireChange(hide);

    assertEqual(jsonOut(document).rules, [{ match: { type: 'regex', value: PATTERN }, hide: true }],
      'the regex was split into pieces at its quantifier');

    // and the plugin can still compile what the editor wrote
    const parsed = window.parseConfig(document.getElementById('jsonOut').value);
    assertEqual(parsed.globalRules.length, 1, 'the plugin dropped the rule the editor produced');
  });

  test('a regex with a comma in it survives a trip through the editor', () => {
    const { document } = loadEditor();
    const cfg = {
      lines: [{ name: 'Bart' }],
      calendars: [{ url: 'https://a.example/school.ics',
        rules: [{ match: { type: 'regex', value: PATTERN }, line: 'Bart' }] }],
    };
    document.getElementById('importIn').value = JSON.stringify(cfg);
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).calendars[0].rules, cfg.calendars[0].rules,
      'loading a config with a quantifier in a regex broke the regex on the way out');
    // the value box shows the whole pattern, not a piece of it
    assertEqual(document.querySelector('#calendars .rule .cond-value').value, PATTERN);
    assert(true);
  });

  // A RULE THIS PAGE CANNOT DRAW IS STILL THE USER'S RULE.
  //
  // The rule card shows one level of conditions. The format nests deeper
  // than that, the AI prompt hands an assistant the nesting in writing, and
  // a configuration written by hand can use all of it. Anything deeper
  // arrived, was read as an empty word matcher, and vanished out of the JSON
  // without a word: the user pasted the result into TRMNL with a rule
  // missing and nothing anywhere to say which.
  function loadCfg(cfg) {
    const { window, document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify(cfg);
    click(document.getElementById('loadImport'));
    return { window, document };
  }

  test('a rule whose matchers nest deeper than the card survives untouched', () => {
    const nested = {
      match: { type: 'or', matchers: [
        { type: 'and', matchers: [{ type: 'word', value: 'L6' }, { type: 'contains', value: 'Maths' }] },
        { type: 'word', value: 'K3' },
      ] },
      line: 'Bart',
    };
    const cfg = { lines: [{ name: 'Bart' }], calendars: [{ url: 'https://a.example/s.ics', rules: [nested] }] };
    const { window, document } = loadCfg(cfg);

    assertEqual(jsonOut(document).calendars[0].rules, [nested],
      'the nested rule was rewritten or dropped on its way through the editor');
    // it is on the page, as what it is, and can be taken out
    const card = document.querySelector('#calendars .rule');
    assert(/Kept as written/.test(card.textContent),
      'a rule the editor cannot show should say so rather than pretend: ' + card.textContent);
    assert(/L6/.test(card.querySelector('code').textContent), 'the rule is not shown at all');
    // and the plugin compiles what came back out
    const parsed = window.parseConfig(document.getElementById('jsonOut').value);
    assertEqual(parsed.calendars[0].rules.length, 1, 'the rule the editor returned does not compile');
  });

  test('a kept-as-written rule follows a line rename, and can be removed', () => {
    const nested = {
      match: { type: 'not', matcher: { type: 'and', matchers: [
        { type: 'word', value: 'Staff' }, { type: 'word', value: 'Meeting' }] } },
      line: 'Bart',
    };
    const { document } = loadCfg({
      lines: [{ name: 'Bart' }], calendars: [{ url: 'https://a.example/s.ics', rules: [nested] }],
    });
    const field = document.querySelector('#lines .card .title-input');
    fireInput(field, 'Bartholomew');
    fireChange(field);
    assertEqual(jsonOut(document).calendars[0].rules[0].line, 'Bartholomew',
      'a rule kept as written was left routing to the old line name');
    assertEqual(jsonOut(document).calendars[0].rules[0].match, nested.match,
      'the matcher was rewritten when the line was renamed');

    const remove = [...document.querySelectorAll('#calendars .rule button')]
      .find((b) => b.textContent === 'Remove rule');
    click(remove);
    assert(!jsonOut(document).calendars[0].rules, 'the rule could not be removed');
  });

  // THE PICKER SAYS "EVERYTHING HERE GOES ON THAT LINE", AND NOTHING ELSE.
  //
  // A leading "any event -> line" rule is shown as the calendar's line
  // picker, which reads better than a rule card. Any rule whose match was
  // any-shaped was folded in the same way, and everything on it except the
  // line was thrown away: a holiday, an allDay, a rewrite. The worst of them
  // was a negated match -- `{"not": {"any"}}` came back as plain `any`, so a
  // rule written to route nothing routed everything.
  test('a leading "any" rule that carries more than a line stays a rule', () => {
    [
      { match: { type: 'any' }, line: 'Mia', holiday: true },
      { match: { type: 'any' }, line: 'Mia', allDay: true },
      { match: { type: 'any' }, line: 'Mia', rewrite: '' },
      { match: { type: 'not', matcher: { type: 'any' } }, line: 'Mia' },
    ].forEach((rule) => {
      const { document } = loadCfg({
        lines: [{ name: 'Mia' }], calendars: [{ url: 'https://a.example/m.ics', rules: [rule] }],
      });
      assertEqual(jsonOut(document).calendars[0].rules, [rule],
        'folded into the line picker and stripped of everything else: ' + JSON.stringify(rule));
    });
  });

  // ...and the answer to "who is this for?" is where it is shown. It used to
  // be a multi-select of declared lines; a box with the name in it says the
  // same thing without a modifier key, and it is the same box the whole flow
  // is built on, so a configuration read back from TRMNL and one typed in
  // from scratch look identical on the card.
  test('a plain "any" rule is shown as the answer to who the calendar is for, and written as line', () => {
    const rule = { match: { type: 'any' }, line: 'Mia' };
    const { document } = loadCfg({
      lines: [{ name: 'Mia' }], calendars: [{ url: 'https://a.example/m.ics', rules: [rule] }],
    });
    assertEqual(jsonOut(document).calendars[0], { url: 'https://a.example/m.ics', line: 'Mia' });
    assertEqual(document.querySelector('#calendars input.who-input').value, 'Mia',
      'the calendar owner should be shown as the answer, not as a rule card');
    assert(!document.querySelector('#calendars .card > .row select[multiple]'),
      'the line multi-select is back on the calendar card');
  });

  // A FEED TWO PEOPLE SHARE IS TWO NAMES, NOT A SECOND CONTROL.
  //
  // `"line": ["Marge", "Homer"]` on a catch-all is a real shape -- a couple's
  // shared calendar, where every event belongs to both of them -- and it used
  // to need a ctrl-click in a multi-select to say. A comma is a list
  // separator everywhere else on this page, so it is one here too, and the
  // round trip has to survive it.
  test('a feed a whole household shares round-trips as a comma-separated answer', () => {
    const rule = { match: { type: 'any' }, line: ['Marge', 'Homer'] };
    const { document } = loadCfg({
      lines: [{ name: 'Marge' }, { name: 'Homer' }],
      calendars: [{ url: 'https://a.example/both.ics', rules: [rule] }],
    });
    assertEqual(document.querySelector('#calendars input.who-input').value, 'Marge, Homer');
    assertEqual(jsonOut(document).calendars[0].line, ['Marge', 'Homer']);
    // and a name is not written onto a feed that is nobody's in particular:
    // that name would be drawn as a line of its own the moment a rule missed
    assert(!('name' in jsonOut(document).calendars[0]),
      'a shared feed was named after the pair of them: ' + JSON.stringify(jsonOut(document).calendars[0]));
  });

  test('a value with a comma in it is not split into two words', () => {
    const rule = { match: { type: 'exact', value: 'Dinner, Bath' }, hide: true };
    const { document } = loadCfg({ calendars: [{ url: 'https://a.example/m.ics', rules: [rule] }] });
    assertEqual(jsonOut(document).calendars[0].rules, [rule],
      'an exact title containing a comma was turned into an "or" of two different titles');
  });
};
