'use strict';

// Matching on more of an event than its title, from the editor's side.
//
// The plugin can read the location, the description, the categories, how
// long an event lasts and when it starts. None of that is reachable if the
// only control on the page is a text box that means "the title", so the
// condition row now reads as a sentence: If the event LOCATION CONTAINS
// Elementary.
//
// What these guard is the round trip. A field that exports but does not
// import back turns one edit in this tool into a silently different
// config, and the person who notices is the one whose board changed.

module.exports = function (test, h) {
  const { loadEditor, fireInput, fireChange, click, buttonByText, jsonOut, selectMulti, assert, assertEqual } = h;

  // A page with one person and one global rule on it, ready to be filled in.
  // The person comes with a calendar, because that is the only way the page
  // makes one: a line IS somebody whose calendar is on the board.
  function withRule() {
    const { document } = loadEditor();
    h.addFeed(document, 'https://a.example/sam.ics', 'Sam');
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    selectMulti(rule.querySelector('.line-picker'), ['Sam']);
    return { document, rule, cond: rule.querySelector('.cond') };
  }
  const matchOf = (document) => jsonOut(document).rules[0].match;

  test('a condition can name the part of the event it reads', () => {
    const { document, cond } = withRule();
    fireInput(cond.querySelector('input[type=text]'), 'Elementary');
    fireChange(cond.querySelector('.cond-field'), 'location');
    assertEqual(matchOf(document), { type: 'word', value: 'Elementary', field: 'location' });
  });

  test('the default reads the title and says nothing about it', () => {
    // No field key at all, because a matcher without one already means
    // "the title, plus the description if there is one" and every config
    // ever written is written against that.
    const { document, cond } = withRule();
    fireInput(cond.querySelector('input[type=text]'), 'Piano');
    assertEqual(matchOf(document), { type: 'word', value: 'Piano' });
  });

  test('a list of values keeps the field on every branch of the or', () => {
    // The comma shorthand fans out into an "or". A field left on only the
    // first branch would quietly search the title for the rest.
    const { document, cond } = withRule();
    fireInput(cond.querySelector('input[type=text]'), 'Gym, Pool');
    fireChange(cond.querySelector('.cond-field'), 'location');
    assertEqual(matchOf(document), { type: 'or', matchers: [
      { type: 'word', value: 'Gym', field: 'location' },
      { type: 'word', value: 'Pool', field: 'location' },
    ] });
  });

  test('how long it lasts is a condition', () => {
    const { document, cond } = withRule();
    fireChange(cond.querySelector('.cond-type'), 'duration');
    fireInput(cond.querySelectorAll('input[type=number]')[0], '240');
    assertEqual(matchOf(document), { type: 'duration', min: 240 });
  });

  test('when it starts is a condition', () => {
    const { document, cond } = withRule();
    fireChange(cond.querySelector('.cond-type'), 'time');
    fireInput(cond.querySelectorAll('input[type=time]')[1], '09:00');
    assertEqual(matchOf(document), { type: 'time', to: '09:00' });
  });

  test('an empty duration or time is no condition at all', () => {
    // It must not export as a matcher with nothing in it: the plugin drops
    // that, so the rule would look set up on this page and do nothing on
    // the board. Exporting no rule at all is the honest answer.
    const { document, cond } = withRule();
    fireChange(cond.querySelector('.cond-type'), 'duration');
    assertEqual(jsonOut(document).rules, undefined);
  });

  test('the controls a condition cannot use are not shown', () => {
    const { cond } = withRule();
    const field = cond.querySelector('.cond-field');
    const text = cond.querySelector('input[type=text]');
    assert(!field.hidden && !text.hidden, 'a word condition should offer a field and a value');
    fireChange(cond.querySelector('.cond-type'), 'duration');
    assert(field.hidden, 'a duration has no text to search, so it has no field to search in');
    assert(text.hidden, 'a duration is not a word');
    assert(!cond.querySelector('.cond-dur').hidden, 'a duration needs its minutes');
    fireChange(cond.querySelector('.cond-type'), 'weekday');
    assert(cond.querySelector('.cond-dur').hidden, 'the minutes stayed behind on a weekday condition');
    assert(!cond.querySelector('.cond-days').hidden, 'a weekday condition needs its days');
  });

  test('every new kind of condition survives being imported', () => {
    const { document } = loadEditor();
    const cfg = {
      lines: [{ name: 'Sam' }],
      rules: [
        { match: { type: 'contains', value: 'Elementary', field: 'location' }, line: 'Sam' },
        { match: { type: 'exact', value: 'Sport', field: 'categories' }, line: 'Sam' },
        { match: { type: 'duration', min: 240, max: 600 }, hide: true },
        { match: { type: 'time', from: '07:00', to: '09:00' }, line: 'Sam' },
        { match: { type: 'not', matcher: { type: 'word', value: 'staff', field: 'description' } }, hide: true },
      ],
      calendars: [{ url: 'https://example.com/a.ics' }],
    };
    document.getElementById('importIn').value = JSON.stringify(cfg);
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).rules, cfg.rules);
  });

  test('a field the plugin does not know is not kept', () => {
    // The plugin ignores an unknown field and falls back to the default.
    // Keeping it here would draw a rule that says it searches one thing
    // while the board searches another.
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Sam' }],
      rules: [{ match: { type: 'word', value: 'Gym', field: 'titel' }, line: 'Sam' }],
      calendars: [{ url: 'https://example.com/a.ics' }],
    });
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).rules[0].match, { type: 'word', value: 'Gym' });
  });
};
