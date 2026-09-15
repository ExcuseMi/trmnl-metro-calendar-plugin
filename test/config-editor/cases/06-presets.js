'use strict';

// The presets in Start (the editor presets). Someone with no ICS links at all should be
// able to see a board, so each preset is a COMPLETE configuration the plugin understands,
// not a sketch: it goes in through loadConfig like an import, and the JSON box has to hand
// back exactly what went in. These tests are the guard on that, on the four things the
// presets exist to teach, and on the two settings a preset must never put back (side and
// color are chosen by the plugin now, and their pickers were removed from this page).

module.exports = function (test, h) {
  const { loadEditor, fireInput, click, jsonOut, assert, assertEqual } = h;

  const IDS = ['family4', 'shifts', 'onecal'];

  function presetButtons(document) {
    return [...document.querySelectorAll('#presets button[data-preset]')];
  }
  function presetIds(document) {
    return presetButtons(document).map((b) => b.getAttribute('data-preset'));
  }
  // Loads a preset with the confirm answered `answer`, and reports whether it was asked.
  function pick(win, doc, id, answer) {
    const asked = { n: 0 };
    win.confirm = () => { asked.n++; return answer !== false; };
    const b = presetButtons(doc).find((x) => x.getAttribute('data-preset') === id);
    if (!b) throw new Error('no preset button for ' + id);
    click(b);
    return asked;
  }
  // Every rule in a config, calendar rules and global ones alike.
  function allRules(cfg) {
    return (cfg.rules || []).concat(...(cfg.calendars || []).map((c) => c.rules || []));
  }

  // One button each, not a dropdown: a preset costs you whatever is in the editor,
  // so what it is has to be readable BEFORE the click that loads it.
  test('Start offers the three presets the plugin ships, by name and by what they teach', () => {
    const { document } = loadEditor();
    const buttons = presetButtons(document);
    assertEqual(buttons.map((b) => [b.getAttribute('data-preset'), b.querySelector('strong').textContent]), [
      ['family4', 'Family of 4'],
      ['shifts', 'Parent on Shifts'],
      ['onecal', 'One Shared Calendar'],
    ]);
    buttons.forEach((b) => {
      const note = b.querySelector('.preset-note');
      assert(note && note.textContent.trim().length > 30,
        b.getAttribute('data-preset') + ' does not say what it teaches before you load it');
      assertEqual(b.getAttribute('aria-pressed'), 'false');
    });
  });

  test('the preset that is loaded is the one marked as loaded', () => {
    const { window, document } = loadEditor();
    pick(window, document, 'shifts', true);
    const pressed = presetButtons(document).filter((b) => b.getAttribute('aria-pressed') === 'true');
    assertEqual(pressed.map((b) => b.getAttribute('data-preset')), ['shifts']);
    // a paste is not a preset, and the mark must not outlive one
    document.getElementById('importIn').value = '{"calendars":[{"url":"https://mine.example/a.ics"}]}';
    window.confirm = () => true;
    click(document.getElementById('loadImport'));
    assertEqual(presetButtons(document).filter((b) => b.getAttribute('aria-pressed') === 'true'), []);
  });

  test('every preset round-trips: what it loads is what the JSON box gives back', () => {
    const { window, document } = loadEditor();
    assertEqual(presetIds(document), IDS);
    IDS.forEach((id) => {
      const ed = loadEditor();
      pick(ed.window, ed.document, id, true);
      const loaded = JSON.parse(ed.document.getElementById('importIn').value);
      // the editor rebuilt this from its own state; if a field did not survive the trip
      // (allDay, an empty rewrite, a rule the editor drops) the two disagree here
      assert.deepStrictEqual(jsonOut(ed.document), loaded, id + ' does not round-trip through the editor');
      assert(loaded.lines.length >= 2, id + ' should be a real board, not one line');
    });
    void window;
  });

  test('the plugin\'s own parseConfig accepts every preset', () => {
    IDS.forEach((id) => {
      const { window, document } = loadEditor();
      pick(window, document, id, true);
      const src = JSON.parse(document.getElementById('jsonOut').value);
      const parsed = window.parseConfig(document.getElementById('jsonOut').value);
      assert(parsed.calendars.length === src.calendars.length, id + ': a calendar was dropped');
      assert(Object.keys(parsed.lines).length === src.lines.length, id + ': a track was dropped');
      assert(parsed.everyoneLine === src.lines[0].name, id + ': first track should be the fallback');
      // every rule the preset writes has to compile, or it is decoration
      const compiled = parsed.globalRules.length + parsed.calendars.reduce((n, c) => n + c.rules.length, 0);
      assert(compiled === allRules(src).length, id + ': ' + (allRules(src).length - compiled) + ' rule(s) did not compile');
      // and every track a rule routes to has to exist
      const names = src.lines.map((t) => t.name);
      allRules(src).forEach((r) => {
        [].concat(r.line || []).forEach((n) => assert(names.indexOf(n) !== -1, id + ': rule routes to unknown track ' + n));
      });
    });
  });

  test('no preset sets side or color, or names a calendar after something that is not a track', () => {
    IDS.forEach((id) => {
      const { window, document } = loadEditor();
      pick(window, document, id, true);
      const cfg = jsonOut(document);
      cfg.lines.forEach((t) => {
        assert.deepStrictEqual(Object.keys(t), ['name'], id + ': a track carries more than a name');
      });
      const names = cfg.lines.map((t) => t.name.toLowerCase());
      cfg.calendars.forEach((c) => {
        if (c.name) assert(names.indexOf(c.name.toLowerCase()) !== -1, id + ': calendar named "' + c.name + '" is not a track');
      });
      // the page's own warning agrees: a shipped preset must not light it up
      [...document.querySelectorAll('#calendars .cal-name-warn')].forEach((w) => {
        assert.strictEqual(w.textContent, '', id + ': the calendar name warning fired on a preset');
      });
      // placeholder links, clearly not anyone's real feed
      cfg.calendars.forEach((c) => assert(/^https:\/\/calendar\.example\.com\//.test(c.url), id + ': ' + c.url + ' does not read as a placeholder'));
    });
  });

  // A preset is where somebody learns what the config can say, so the two
  // holiday shapes have to be IN one: the day's, and a line's. They are the
  // pair that is easy to get wrong, because the word is the same and only
  // the presence of a line tells them apart.
  test('a preset teaches both holiday shapes', () => {
    const { window, document } = loadEditor();
    pick(window, document, 'family4', true);
    const cfg = jsonOut(document);
    const dayWide = cfg.calendars.filter((c) => c.holiday);
    assert(dayWide.length === 1, 'no calendar marked as a holiday feed');
    assert(!dayWide[0].name,
      'the holiday feed carries a name, which is the line it must not create');
    const owned = cfg.calendars
      .reduce((all, c) => all.concat(c.rules || []), [])
      .filter((r) => r.holiday && r.line);
    assert(owned.length >= 1,
      'no rule shows a holiday that belongs to particular lines');
    assert(Array.isArray(owned[0].line) && owned[0].line.length > 1,
      'the owned holiday should show the shared case, which is the one with a tie');
    void window;
  });

  test('the three presets teach three different things, not one shape three times', () => {
    const got = {};
    IDS.forEach((id) => {
      const { window, document } = loadEditor();
      pick(window, document, id, true);
      const cfg = jsonOut(document);
      const rules = allRules(cfg);
      got[id] = {
        shared: rules.some((r) => Array.isArray(r.line) && r.line.length > 1),
        renames: rules.some((r) => typeof r.rewrite === 'string' && r.rewrite && !/^\^/.test(r.match.value || '')),
        strips: rules.some((r) => typeof r.rewrite === 'string' && r.rewrite && /^\^/.test(r.match.value || '')),
        hides: rules.some((r) => r.hide === true),
        global: (cfg.rules || []).length > 0,
        keepEmpty: cfg.calendars.some((c) => c.keepLine === true),
      };
    });
    assert(got.family4.shared, 'Family of 4 should draw one event across several tracks');
    assert(got.family4.hides, 'Family of 4 should hide the school feed\'s noise');
    assert(got.family4.keepEmpty, 'Family of 4 should keep the quiet line on the board');
    // what the shifts preset teaches is the GLOBAL rule, applied to every
    // calendar rather than to one feed
    assert(got.shifts.global, 'Parent on Shifts should show a rule applied to every calendar');
    assert(!got.family4.global && !got.onecal.global, 'and it should be the only one that does');
    assert(got.onecal.strips, 'One Shared Calendar should route on a title prefix and then strip it');
    assert(!got.onecal.shared, 'One Shared Calendar should not just repeat the other two');
  });

  test('a preset replaces the editor, and asks first when there is something to lose', () => {
    const { window, document } = loadEditor();
    // nothing typed yet: swapping presets is not worth a dialog
    let asked = pick(window, document, 'family4', true);
    assertEqual(asked.n, 0);
    assertEqual(jsonOut(document).lines[0].name, 'Sam');
    asked = pick(window, document, 'onecal', true);
    assert.strictEqual(asked.n, 0, 'an untouched preset should swap without asking');
    assertEqual(jsonOut(document).lines[0].name, 'Priya');

    // now it is the user's config, not ours
    fireInput(document.querySelector('#lines .card input.title-input'), 'Robin');
    const mine = document.getElementById('jsonOut').value;
    asked = pick(window, document, 'shifts', false);
    assert.strictEqual(asked.n, 1, 'edited work should not be thrown away silently');
    assert.strictEqual(document.getElementById('jsonOut').value, mine, 'declining the confirm must change nothing');
    assert(!presetButtons(document).some((b) => b.getAttribute('data-preset') === 'shifts' && b.getAttribute('aria-pressed') === 'true'),
      'a declined preset should not look loaded');

    asked = pick(window, document, 'shifts', true);
    assertEqual(asked.n, 1);
    assertEqual(jsonOut(document).lines.map((t) => t.name), ['Jordan', 'Casey', 'Riley']);
    assert(document.getElementById('jsonOut').value !== mine, 'accepting the confirm must replace everything');
  });

  test('a pasted config is never silently swapped for a preset', () => {
    const { window, document } = loadEditor();
    document.getElementById('importIn').value = '{"calendars":[{"url":"https://mine.example/a.ics"}]}';
    const asked = pick(window, document, 'family4', false);
    assert.strictEqual(asked.n, 1, 'text waiting in the paste box counts as work');
    assertEqual(document.getElementById('importIn').value, '{"calendars":[{"url":"https://mine.example/a.ics"}]}');
  });
};
