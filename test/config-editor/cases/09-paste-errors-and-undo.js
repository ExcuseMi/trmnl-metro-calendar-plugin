'use strict';

// Two things the tool used to get wrong in the same place: what it does with a paste it
// cannot read, and what it does with the work it throws away.
//
// A configuration with one missing brace fell through the JSON reader into the "one link
// per line" reader, and every line of the file became a calendar: four calendars whose
// URLs were "{", "\"calendars\": [", the rest of the object and "]". The page then said
// "Loaded 4 calendar(s)" in green. Nothing about that is true, and the JSON box had by
// then replaced the thing that was wrong with something worse.
//
// And every load replaced the editor outright while removing a track, a calendar or a
// rule threw it away on the spot, with nothing anywhere to put any of it back.

module.exports = function (test, h) {
  const { loadEditor, fireInput, click, jsonOut, assert, assertEqual } = h;

  function status(document) { return document.getElementById('importStatus').textContent; }
  function load(document, text) {
    document.getElementById('importIn').value = text;
    click(document.getElementById('loadImport'));
  }

  test('a configuration that does not parse is refused, and nothing is loaded', () => {
    const { document } = loadEditor();
    load(document, '{\n  "calendars": [\n    {"url": "https://a.example/x.ics"},\n}\n');
    assertEqual(jsonOut(document), { lines: [], calendars: [] }, 'a broken paste must not reach the editor');
    const msg = status(document);
    assert(/not readable/i.test(msg), 'the message does not say it failed: ' + msg);
    assert(/line \d+/.test(msg), 'the message does not say where the mistake is: ' + msg);
    assert(/nothing was loaded/i.test(msg), 'the message does not say the editor was left alone: ' + msg);
    assert(document.getElementById('importStatus').className.indexOf('err') >= 0, 'a refusal must not read as a success');
  });

  test('a paste that had to be repaired says so', () => {
    const cfg = { lines: [{ name: 'Fry' }], calendars: [{ url: 'https://a.example/x.ics' }] };
    const pretty = JSON.stringify(cfg, null, 1);
    const { document } = loadEditor();
    load(document, 'Sure!\n\n```json\n'
      + pretty.replace(/([[\]{}])/g, '\\$1').split('\n').join('\\\n')
      + '\n```\n\nPaste that in.');
    assertEqual(jsonOut(document).calendars, cfg.calendars);
    const msg = status(document);
    assert(/chat window/i.test(msg), 'a recovered paste is reported as if nothing happened: ' + msg);
    assert(/code fence/.test(msg), 'the message does not name what was taken out: ' + msg);
  });

  test('a list of links reports the lines that were not links', () => {
    const { document } = loadEditor();
    load(document, 'https://a.example/x.ics\nmy calendar\nwebcal://b.example/y.ics\n');
    assertEqual(jsonOut(document).calendars,
      [{ url: 'https://a.example/x.ics' }, { url: 'webcal://b.example/y.ics' }]);
    assert(/1 line did not look like a link/.test(status(document)), 'the skipped line was skipped silently: ' + status(document));
  });

  test('a configuration whose calendars key is misspelled is not reported as loaded', () => {
    // unknown keys are ignored in silence by the plugin, which is exactly why
    // the editor has to be the one to notice there is nothing in there
    const { document } = loadEditor();
    load(document, '{"calendar": [{"url": "https://a.example/x.ics"}]}');
    const msg = status(document);
    assert(/no calendars/i.test(msg), msg);
    assert(/calendars/.test(msg), 'the message does not name the key to check: ' + msg);
  });

  test('a bare array of calendars is read as the calendars', () => {
    const { document } = loadEditor();
    load(document, '[{"url": "https://a.example/x.ics"}]');
    assertEqual(jsonOut(document).calendars, [{ url: 'https://a.example/x.ics' }]);
  });

  test('a link that is not a link is flagged on the calendar that holds it', () => {
    const { document } = loadEditor();
    load(document, '{"calendars": [{"url": "https://a.example/x.ics"}, {"url": "webcal://b.example/y.ics"}]}');
    assertEqual([...document.querySelectorAll('.cal-url-warn')].map((n) => n.textContent), ['', '']);
    fireInput(document.querySelector('#calendars .card input[type=text]:not(.title-input)'), 'calendar.example.com my feed');
    const w = [...document.querySelectorAll('.cal-url-warn')].map((n) => n.textContent);
    assert(/space/i.test(w[0]), 'a URL with a space in it is not flagged: ' + w[0]);
    assertEqual(w[1], '', 'the other calendar was flagged too');
  });

  test('a calendar that routes every event cannot leak its name, and is not warned about', () => {
    // The shipped demo has a calendar called "Work" that sends everything to Sam's line.
    // The warning fired on it anyway, on every load, which is how a warning stops being read.
    const { document } = loadEditor();
    load(document, JSON.stringify({
      lines: [{ name: 'Sam' }],
      calendars: [
        { name: 'Work', url: 'https://a.example/w.ics', line: 'Sam' },
        { name: 'School', url: 'https://a.example/s.ics', rules: [{ match: { type: 'word', value: 'L6' }, line: 'Sam' }] },
      ],
    }));
    const w = [...document.querySelectorAll('.cal-name-warn')].map((n) => n.textContent);
    assertEqual(w[0], '', 'a calendar with a catch-all rule cannot draw its own line, so it must not be flagged');
    assert(/School/.test(w[1]), 'a calendar that can still leak an unrouted event must be flagged: ' + w[1]);
  });

  test('undo puts back a load, and a removed calendar', () => {
    const { window, document } = loadEditor();
    window.confirm = () => true;
    const undoBtn = document.getElementById('undoBtn');
    assert(undoBtn.disabled, 'there is nothing to undo on a fresh page');

    click([...document.querySelectorAll('#presets button[data-preset]')].find((b) => b.getAttribute('data-preset') === 'family4'));
    assert(!undoBtn.disabled, 'loading a preset should be undoable');
    assert(/Family of 4/.test(undoBtn.textContent), 'the button does not say what it would undo: ' + undoBtn.textContent);

    const loaded = document.getElementById('jsonOut').value;
    const cals = jsonOut(document).calendars.length;
    click(document.querySelector('#calendars .card .card-head button'));
    assertEqual(jsonOut(document).calendars.length, cals - 1);
    click(undoBtn);
    assertEqual(document.getElementById('jsonOut').value, loaded, 'undo did not put the calendar back');

    click(undoBtn);
    assertEqual(jsonOut(document), { lines: [], calendars: [] }, 'undo did not put the empty editor back');
    assert(undoBtn.disabled, 'the button should go quiet when there is nothing left to undo');
  });

  test('undo puts back a removed person and a removed rule', () => {
    const { document } = loadEditor();
    h.addFeed(document, 'https://a.example/sam.ics', 'Sam');
    click(document.getElementById('addGlobalRule'));
    fireInput(document.querySelector('#globalRules .rule .cond input[type=text]'), 'Dentist');
    const rule = document.querySelector('#globalRules .rule');
    const hide = h.checkByLabel(rule, 'hide it from the map');
    hide.checked = true;
    hide.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
    const withRule = document.getElementById('jsonOut').value;
    assert(jsonOut(document).rules.length === 1, 'sanity: the rule exports');

    click([...rule.querySelectorAll('button')].find((b) => b.textContent === 'Remove rule'));
    assert(!jsonOut(document).rules, 'the rule should be gone');
    click(document.getElementById('undoBtn'));
    assertEqual(document.getElementById('jsonOut').value, withRule, 'undo did not put the rule back');

    click([...document.querySelectorAll('#lines .card button')].find((b) => b.textContent === 'Remove'));
    assertEqual(jsonOut(document).lines, []);
    click(document.getElementById('undoBtn'));
    assertEqual(jsonOut(document).lines, [{ name: 'Sam' }], 'undo did not put the person back');
  });

  test('there is nothing to copy from an empty editor, and the page says so', () => {
    const { document } = loadEditor();
    assert(document.getElementById('copyJson').disabled, 'an empty configuration is not worth copying');
    assert(!document.getElementById('outEmpty').hidden, 'nothing tells the reader why');
    h.addFeed(document, 'https://a.example/x.ics');
    assert(!document.getElementById('copyJson').disabled, 'one calendar is enough to have something to paste');
    assert(document.getElementById('outEmpty').hidden);
  });
};
