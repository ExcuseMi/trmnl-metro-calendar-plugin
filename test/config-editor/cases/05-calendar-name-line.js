'use strict';

// A calendar's `name` is not a caption. Any event in it that no rule routes falls back to
// that name, and the fallback name is drawn as a LINE. Someone had an assistant write a
// configuration where every calendar got a descriptive name, and the board came back with
// seven lines for five people: two of them were calendar names that had each caught one
// stray event. Nothing in the JSON said so. The editor now does.

module.exports = function (test, h) {
  const { loadEditor, fireInput, click, assert, assertEqual } = h;

  function warnings(document) {
    return [...document.querySelectorAll('#calendars .cal-name-warn')].map((n) => n.textContent);
  }
  // The name is not the question this card asks any more, so it is not the
  // field at the top of it: "who is this for?" writes it, and what is left
  // under More options is the case the answer cannot cover, a feed whose own
  // name is worth keeping.
  const nameField = (card) => card.querySelector('input.cal-name');
  const whoField = (card) => card.querySelector('input.who-input');

  test('a calendar named after something that is not a person is flagged', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Fry' }, { name: 'Leela' }],
      calendars: [
        { name: 'Fry', url: 'https://a.example/fry.ics' },
        { name: 'Deliveries', url: 'https://a.example/deliveries.ics' },
        { url: 'https://a.example/unnamed.ics' },
      ],
    });
    click(document.getElementById('loadImport'));
    const w = warnings(document);
    assertEqual(w.length, 3);
    assertEqual(w[0], '', 'a calendar named after a person is fine: ' + w[0]);
    assert(/Deliveries/.test(w[1]), 'the offending name is not flagged');
    assert(/line/i.test(w[1]), 'the warning never says what the name actually does: ' + w[1]);
    // ...and it has to name the control that fixes it. The warning used to
    // offer three remedies -- rename the calendar, add a line, clear the
    // name -- and omit the one right beside it, which is the one most people
    // actually want: say whose feed this is. That control is now the only
    // question the card asks, so the warning points at it by its own words.
    assert(/who is this for/i.test(w[1]),
      'the warning does not mention the control sitting next to it: ' + w[1]);
    assertEqual(w[2], '', 'an unnamed calendar has nothing to fall back to: ' + w[2]);
  });

  test('the warning appears as the name is typed, and clears when a person matches it', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Fry' }],
      calendars: [{ url: 'https://a.example/x.ics' }],
    });
    click(document.getElementById('loadImport'));
    assertEqual(warnings(document)[0], '');

    fireInput(nameField(document.querySelector('#calendars .card')), 'Planet Express');
    assert(/Planet Express/.test(warnings(document)[0]), 'typing a name that is nobody is not flagged');

    // matching a person is the fix the warning asks for, so it has to clear
    fireInput(nameField(document.querySelector('#calendars .card')), 'fry');
    assertEqual(warnings(document)[0], '', 'a name that matches a person (any case) must not warn');
  });

  // THE FIX THE WARNING NAMES IS THE ONE THE CARD OFFERS.
  //
  // This used to be "add the missing line": press + Add a line up in the
  // Lines section, type the name, and the warning downstream settles. There
  // is no such button any more, and there should not be -- a person declared
  // with no calendar behind them draws an empty line. Answering "who is this
  // for?" does both jobs at once: it makes Leela a person AND routes every
  // event in the feed to her, so nothing can reach the fallback at all.
  test('answering "who is this for?" settles the warning, and makes the person', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Fry' }],
      calendars: [{ name: 'Leela', url: 'https://a.example/x.ics' }],
    });
    click(document.getElementById('loadImport'));
    assert(warnings(document)[0].length > 0, 'the imported name should be flagged');

    const who = whoField(document.querySelector('#calendars .card'));
    fireInput(who, 'Leela');
    assertEqual(warnings(document)[0], '', 'answering who it is for should settle it');
    h.fireChange(who);
    assertEqual(h.jsonOut(document).lines, [{ name: 'Fry' }, { name: 'Leela' }],
      'the answer did not add Leela to the people on the map');
    assertEqual(h.jsonOut(document).calendars[0].line, 'Leela',
      'the answer did not route the feed to her');
    assert(!document.getElementById('addLine'),
      'there is a way to declare a person with no calendar again');
  });
};
