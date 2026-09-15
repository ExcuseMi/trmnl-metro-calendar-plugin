'use strict';

// A RULE NAMES A LINE BY ITS NAME, SO THE NAME IS A REFERENCE.
//
// Rules say `"line": "Mia"`, calendars are assigned the same way, and
// nothing in the format ties either back to the entry in `lines` except the
// spelling. So a line removed in the editor went on being named by every
// rule that routed to it -- and a rule naming a line that nothing declares
// does not fail or warn: the plugin resolves the name and draws a line for
// it. Removing Mia from the Lines section put Mia straight back on the
// board, and the editor showed no line called Mia anywhere to explain it.
// Renaming had the mirror problem: the rules kept routing to the old
// spelling, so the board grew the old name back as a line of its own and
// the renamed one drew empty.

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, fireChange, jsonOut, assert, assertEqual } = h;

  const CONFIG = {
    lines: [{ name: 'Sam' }, { name: 'Mia' }],
    rules: [{ match: { type: 'word', value: 'Swim' }, line: ['Sam', 'Mia'] }],
    calendars: [{ url: 'https://a.example/m.ics', line: 'Mia' }],
  };

  function loaded(cfg) {
    const { window, document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify(cfg || CONFIG);
    click(document.getElementById('loadImport'));
    return { window, document };
  }
  const lineCards = (document) => [...document.querySelectorAll('#lines .card')];
  const removeLine = (card) => click(card.querySelector('button[title="Remove this person"]'));

  test('removing a line takes it out of the rules that routed to it', () => {
    const { window, document } = loaded();
    const before = document.getElementById('jsonOut').value;
    removeLine(lineCards(document)[1]);

    const text = document.getElementById('jsonOut').value;
    assert(text.indexOf('Mia') === -1,
      'the removed line is still named in the configuration, so the board still draws it: ' + text);
    assertEqual(jsonOut(document).rules, [{ match: { type: 'word', value: 'Swim' }, line: 'Sam' }],
      'the shared rule should keep the line that is left');

    // and the plugin agrees: no phantom line resolved out of a rule
    const parsed = window.parseConfig(text);
    assertEqual(Object.keys(parsed.lines).length, 1, 'the plugin still sees two lines');

    click(document.getElementById('undoBtn'));
    assertEqual(document.getElementById('jsonOut').value, before,
      'undo should put the line back together with the rules that named it');
  });

  test('renaming a line carries the rules that route to it', () => {
    const { document } = loaded();
    const field = lineCards(document)[1].querySelector('.title-input');
    fireInput(field, 'Mila');
    fireChange(field);

    const out = jsonOut(document);
    assertEqual(out.lines.map((t) => t.name), ['Sam', 'Mila']);
    assertEqual(out.rules[0].line, ['Sam', 'Mila'], 'the shared rule still routes to the old name');
    assertEqual(out.calendars[0].line, 'Mila',
      'the calendar still sends its events to a line that no longer exists');
    assert(document.getElementById('jsonOut').value.indexOf('Mia') === -1,
      'the old name survives somewhere, and the board will draw it as a line of its own');
  });

  // TYPING PASSES THROUGH NAMES YOU DID NOT MEAN.
  //
  // Renaming carries the rules across on every keystroke, and on the way to
  // "Alexa" the field reads "Alex" -- which is another line's name. Carrying
  // references through that would hand this line every rule belonging to
  // Alex, and the next keystroke would rename them all again. So a rename
  // through a name another line already answers to is left alone.
  test('renaming past another line\'s name does not steal that line\'s rules', () => {
    const { document } = loaded({
      lines: [{ name: 'Al' }, { name: 'Alex' }],
      calendars: [
        { url: 'https://a.example/one.ics', line: 'Al' },
        { url: 'https://a.example/two.ics', line: 'Alex' },
      ],
    });
    const field = lineCards(document)[0].querySelector('.title-input');
    fireInput(field, 'Ale');
    fireInput(field, 'Alex');  // collides with the second line, in passing
    fireInput(field, 'Alexa');
    fireChange(field);

    const out = jsonOut(document);
    assertEqual(out.lines.map((t) => t.name), ['Alexa', 'Alex']);
    assertEqual(out.calendars[1].line, 'Alex',
      'the other line lost its own calendar to a rename that passed through its name');
    assertEqual(out.calendars[0].line, 'Alexa',
      'the renamed line did not take its own calendar with it');
  });
};
