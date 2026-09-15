module.exports = function (test, h) {
  const { loadEditor, fireInput, fireChange, click, buttonByText, checkByLabel, jsonOut, selectMulti, assert, assertEqual, addFeed } = h;

  // A person exists because a calendar was answered for, so every case below
  // that needs one to route a rule to gets one the way the page makes them.
  function withPerson(name) {
    const { window, document } = loadEditor();
    addFeed(document, 'https://example.com/' + name.toLowerCase() + '.ics', name);
    return { window, document };
  }

  test('a fresh editor exports an empty configuration', () => {
    const { document } = loadEditor();
    assertEqual(jsonOut(document), { lines: [], calendars: [] });
    assert(!document.querySelector('#calendars .card'),
      'the page opens with a blank calendar card again, which exports nothing and asks for everything');
    assert(!document.querySelector('#lines .card'),
      'the page opens with a blank person on it');
  });

  // Side and colour used to be two <select>s on every track card. They are gone: the
  // plugin balances sides against the day's real event counts and picks colours from the
  // panel's theme, and neither could be guessed well from this page. What must NOT happen
  // is that opening an old configuration here silently strips them, so the two halves are
  // tested apart: no control to set one, but an imported one survives the round trip.
  test('a person\'s card offers no side or colour control', () => {
    const { document } = withPerson('Sam');
    const card = document.querySelector('#lines .card');
    assertEqual(card.querySelector('.title-input').value, 'Sam');
    assertEqual(card.querySelectorAll('select').length, 0);
    assertEqual(jsonOut(document).lines, [{ name: 'Sam' }]);
    const labels = [...document.querySelectorAll('#lines label')].map((l) => l.textContent);
    assert(!labels.some((t) => /side|colour|color/i.test(t)), 'a side/colour control is still offered: ' + JSON.stringify(labels));
  });

  test('a side and colour in an imported configuration are dropped: the board chooses both', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Sam', color: 'gray-20', side: 'left' }, { name: 'Alex' }],
      calendars: [{ url: 'https://example.com/a.ics' }],
    });
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).lines, [{ name: 'Sam' }, { name: 'Alex' }]);
  });

  test('every export says which version of the format it is written in, and links what it means', () => {
    const { document } = loadEditor();
    const out = JSON.parse(document.getElementById('jsonOut').value);
    assertEqual(out.version, 1);
    assert(/CONFIG\.md$/.test(out.docs), 'no documentation link in the configuration: ' + out.docs);
    assertEqual(Object.keys(out).slice(0, 2), ['version', 'docs'], 'the version and the link are not what it opens with');
  });

  // THE WHOLE CONFIGURATION FOR THE ORDINARY CASE, FROM TWO ANSWERS.
  //
  // A link and a name. What comes out is the shape the plugin is built
  // around, and the same shape demo-config.json is written in: the person in
  // `lines`, the feed named after them so the board can say whose feed is
  // down, and the one rule that sends everything in it to their line.
  test('a link and a name export the person, and the feed with whose it is', () => {
    const { document } = loadEditor();
    addFeed(document, 'https://example.com/a.ics', 'Alex');
    assertEqual(jsonOut(document), {
      lines: [{ name: 'Alex' }],
      calendars: [{ url: 'https://example.com/a.ics', name: 'Alex',
        line: 'Alex' }],
    });
  });

  test('a global rule with a word condition, a person and hide exports correctly', () => {
    const { document } = withPerson('Kids');
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'L2');
    selectMulti(rule.querySelector('.line-picker'), ['Kids']);
    // unticked by default, and a word rule with a line renames unless told not to
    assertEqual(jsonOut(document).rules, [{ match: { type: 'word', value: 'L2' }, line: 'Kids' }]);
    const hide = checkByLabel(rule, 'hide it from the map');
    hide.checked = true; fireChange(hide);
    assertEqual(jsonOut(document).rules[0].hide, true);
  });

  // THE TWO ACTIONS YOU USED TO HAVE TO HAND-EDIT JSON FOR.
  //
  // Both survived a round trip already, so a config carrying one was safe
  // in the editor; neither could be SET in it. Stripping a class code is
  // the commonest thing anybody wants a rule for, and it is written as an
  // empty `rewrite` -- which a text box cannot express, since every rule
  // starts with an empty box.
  test('a rule can delete the matched text, which no text box can say', () => {
    const { document } = loadEditor();
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'L6');
    const wipe = checkByLabel(rule, 'delete the matched text');
    wipe.checked = true; fireChange(wipe);
    assertEqual(jsonOut(document).rules, [{ match: { type: 'word', value: 'L6' }, rewrite: '' }]);
    // and it takes the rename box out of play: a rule cannot both delete
    // the matched text and put something else there
    assert(rule.querySelector('input[type=text][placeholder^="new title"]').disabled,
      'the rename box is still live under a rule that deletes what it matched');
  });

  test('a rule can move a timed event to the head of the line', () => {
    const { document } = withPerson('Mia');
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'Leave');
    selectMulti(rule.querySelector('.line-picker'), ['Mia']);
    const allDay = checkByLabel(rule, 'head of the line');
    allDay.checked = true; fireChange(allDay);
    assertEqual(jsonOut(document).rules[0].allDay, true);
  });

  test('a rule with no action is left out of the JSON and flagged', () => {
    const { document } = loadEditor();
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'Dentist');
    assert(!jsonOut(document).rules, 'rule without action must not export');
    assert(rule.querySelector('.status.err').textContent.length > 0, 'warning shown');
  });

  test('two conditions export as an and-matcher', () => {
    const { document } = withPerson('Sam');
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'Piano');
    click(buttonByText(rule, '+ condition'));
    const conds = rule.querySelectorAll('.cond');
    // By class, not by index: the row grew a field select between these
    // two the day matching stopped being title-only.
    fireChange(conds[1].querySelector('.cond-comb'), 'or');
    fireChange(conds[1].querySelector('.cond-type'), 'weekday');
    click(buttonByText(conds[1], 'Wed'));
    selectMulti(rule.querySelector('.line-picker'), ['Sam']);
    assertEqual(jsonOut(document).rules[0].match, { type: 'or', matchers: [{ type: 'word', value: 'Piano' }, { type: 'weekday', value: ['WE'] }] });
  });
};
