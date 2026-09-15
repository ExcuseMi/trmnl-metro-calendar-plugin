'use strict';

const fs = require('fs');
const path = require('path');

// THE PAGE OPENS ON ONE QUESTION.
//
// It has opened on three different things now, and each move was the same
// argument made harder. First it was the whole form at once: paste box, AI,
// lines, calendars, rules, preview, JSON, with the three examples a small row
// inside the first of them. Then it opened on the examples, because somebody
// arriving has not decided to configure anything yet and a board they have
// watched draw answers "is this worth my evening" better than seven sections
// they have not filled in.
//
// It opens on the WIZARD now, because deciding it is worth the evening was
// never the part that defeated anybody. Finding a calendar's hidden address
// is, and a page that opens on seven headings leaves that entirely to the
// reader. The wizard asks one thing at a time, spells out the clicks for each
// calendar service by the names they are spelled on screen, and proves each
// link worked before moving on. The examples are still one press away, and
// the form is still there in full for anybody who wants it.
//
// The gate is CSS on a data attribute, never a section taken out of the page:
// a section that is not in the DOM cannot be linked to, cannot be read by a
// screen reader walking the document, and loses whatever was typed in it.

module.exports = function (test, h) {
  const { loadEditor, click, assert, assertEqual } = h;

  test('the page opens on the wizard, with one question on it', () => {
    const { document } = loadEditor();
    assertEqual(document.getElementById('page').getAttribute('data-stage'), 'wizard');
    // still all there, just not shown
    ['station-demo', 'station-agent', 'station-start', 'station-lines', 'station-calendars',
      'station-rules', 'station-output'].forEach((id) => {
      assert(document.getElementById(id), id + ' was taken out of the page rather than hidden');
    });
    // and it is a question, not a form: one heading, and no text box until
    // something has been asked for
    assert(/\?|set up/i.test(document.getElementById('wzQ').textContent),
      'the wizard opens without asking anything: ' + document.getElementById('wzQ').textContent);
    assertEqual(document.querySelectorAll('#wzBody input[type=text]').length, 0,
      'the first screen is already a form');
  });

  // Both are still reachable in one press, from the page the reader lands on.
  test('the examples and the full form are one press away from the wizard', () => {
    const { document } = loadEditor();
    click(document.getElementById('wzSeeExample'));
    assertEqual(document.getElementById('page').getAttribute('data-stage'), 'demo');

    const again = loadEditor();
    click(again.document.getElementById('wzExpert'));
    assertEqual(again.document.getElementById('page').getAttribute('data-stage'), 'build');
  });

  // THE CALENDARS COME BEFORE THE PEOPLE, BECAUSE THE PEOPLE COME OUT OF THEM.
  //
  // Lines used to be the first thing to fill in: a list of people to declare,
  // with nothing yet to put on them, and side and colour pickers the plugin
  // has long since taken over. A line IS a person, so "here is a calendar, it
  // is Homer's" declares one. The people section is a view of those answers
  // now, and it sits after the question it reads.
  test('the steps run in the order somebody does them, with the preview beside them', () => {
    const { document } = loadEditor();
    const ids = [...document.querySelectorAll('.col-steps > section')].map((s) => s.id);
    assertEqual(ids, [
      'station-wizard',
      'station-demo', 'station-start', 'station-agent', 'station-calendars',
      'station-lines', 'station-rules', 'station-output',
    ]);
    // The preview is not a step: it is the panel the steps draw into, and it
    // sits in its own column so it stays in view.
    const panel = document.querySelector('.col-preview #station-preview');
    assert(panel, 'the preview is not in the preview column');
    assert(document.getElementById('runPreview'), 'the draw button went missing in the move');
  });

  test('"I am ready to do this for real" offers the three ways, and each one clears the example', () => {
    const { document } = loadEditor();
    assert(document.getElementById('realChoice').hidden, 'the choice is showing before it is asked for');
    click(document.getElementById('goReal'));
    assert(!document.getElementById('realChoice').hidden, 'the choice did not open');
    // Step by step is listed first and is the one the keyboard lands on: it is
    // the route almost everybody leaving the examples should take.
    assertEqual([...document.getElementById('realChoice').querySelectorAll('button')].map((b) => b.id),
      ['chooseWizard', 'chooseAi', 'chooseManual']);
    assertEqual(document.activeElement, document.getElementById('chooseWizard'));

    click(document.getElementById('chooseManual'));
    assertEqual(document.getElementById('page').getAttribute('data-stage'), 'build');
    assertEqual(document.getElementById('importIn').value, '', 'the example was left in the paste box');
    const out = JSON.parse(document.getElementById('jsonOut').value || '{}');
    assertEqual(out.calendars || [], [], 'the example config survived into the real one');
    assertEqual(out.lines || [], [], 'the example lines survived into the real one');
  });

  // THE AI ROUTE STARTS AT THE LINKS. It used to jump past the paste box to
  // the prompt, which then had no calendars to describe -- and with no
  // calendars there were no unread feeds, so the relay was never offered.
  test('the AI choice starts at the paste box, not at an empty prompt', () => {
    const { document } = loadEditor();
    click(document.getElementById('goReal'));
    click(document.getElementById('chooseAi'));
    assertEqual(document.getElementById('page').getAttribute('data-stage'), 'ai');
    assert(/Paste your calendar links here/.test(document.getElementById('importStatus').textContent),
      'the AI route does not ask for the links first');
  });

  test('on the AI route, loading links keeps the prompt on screen', () => {
    const { document } = loadEditor();
    click(document.getElementById('goReal'));
    click(document.getElementById('chooseAi'));
    document.getElementById('importIn').value = 'https://a.example/sam.ics\nhttps://a.example/alex.ics';
    click(document.getElementById('loadImport'));
    assertEqual(document.getElementById('page').getAttribute('data-stage'), 'ai',
      'loading the links jumped to the form and hid the prompt they were pasted in for');
  });

  test('pasting a configuration goes straight to the form, from anywhere but the AI route', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Sam' }], calendars: [{ url: 'https://a.example/s.ics', name: 'Sam' }],
    });
    click(document.getElementById('loadImport'));
    assertEqual(document.getElementById('page').getAttribute('data-stage'), 'build');
  });

  // A LINE CARD ALSO CARRIES THE CLASS "line".
  //
  // So the two-column page grid, written as a bare `.line`, landed on every
  // line card as well: each card became a two-column grid, with the swatch,
  // the name, the arrows and Remove stacked one per row and the hint beside
  // them in the second column. The page rule has to name the element.
  test('the page grid is scoped to the page, not to anything called a line', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../tools/config-editor.html'), 'utf-8');
    const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
    css.split('\n').forEach((line) => {
      const sel = line.split('{')[0];
      if (!/display:\s*grid/.test(line)) return;
      assert(!/(^|[\s,])\.line\b/.test(sel),
        'a bare ".line" rule sets display:grid, which also hits every line card: ' + sel.trim());
    });
  });

  // ZOOM IS THE FRAMEWORK'S PIXEL RATIO, AND IT IS NOT ALWAYS 2.
  //
  // The preview sizes a screen element at device pixels over `zoom` and
  // lets the framework's own scaling take it back up. `screen--v2` (the X)
  // declares `--screen-w: 1040px` and `--pixel-ratio: 1.8`, so a `zoom` of
  // 2 made the element 936px, 104px narrower than the 1040 the layout
  // engine measures and lays out to: the X preview drew a board that ran
  // off its own right edge and out of the bottom. Nothing else on the page
  // did, because every other device here has a ratio of 1.
  //
  // The framework CSS is a build artefact and is not in the repo, so this
  // checks it when the layout suite has fetched it and says nothing when it
  // has not.
  test('every preview device is sized by the framework\'s own pixel ratio', () => {
    const css = path.join(__dirname, '../../layout/.cache/plugins.local.css');
    if (!fs.existsSync(css)) return; // layout suite has not fetched it here
    const text = fs.readFileSync(css, 'utf-8');
    const src = fs.readFileSync(path.join(__dirname, '../../../tools/config-editor.html'), 'utf-8');
    const table = src.slice(src.indexOf('var MODELS = {'), src.indexOf('};', src.indexOf('var MODELS = {')));
    const rows = [...table.matchAll(/\bw:\s*(\d+),\s*h:\s*(\d+),\s*zoom:\s*([\d.]+)[\s\S]*?classes:\s*"([^"]+)"/g)];
    assert(rows.length >= 4, 'could not read the device table');
    rows.forEach((m) => {
      const [, w, , zoom, classes] = m;
      const device = classes.split(' ').find((c) => /^screen--(og|ogv2|v2)$/.test(c));
      if (!device) return;
      const rule = text.match(new RegExp(device.replace('screen--', 'screen--') + '\\{[^}]*'));
      if (!rule) return;
      const ratio = (rule[0].match(/--pixel-ratio:\s*([\d.]+)/) || [])[1];
      const screenW = (rule[0].match(/--screen-w:\s*(\d+)px/) || [])[1];
      const screenH = (rule[0].match(/--screen-h:\s*(\d+)px/) || [])[1];
      if (!ratio || !screenW) return;
      assertEqual(String(zoom), String(ratio),
        device + ': the preview scales by ' + zoom + " but the framework's pixel ratio is " + ratio);
      // Either way round: a portrait entry is the same screen on its side.
      const css1 = Math.round(Number(w) / Number(zoom));
      assert(css1 === Number(screenW) || css1 === Number(screenH),
        device + ': ' + w + '/' + zoom + ' is ' + css1 + 'px, which is neither of the framework\'s own '
          + screenW + 'x' + screenH);
    });
  });

  // Every screen class a preview device is given is one the framework has,
  // so a misspelt palette draws nothing different and says so here instead.
  test('every preview screen class is one the framework styles', () => {
    const css = path.join(__dirname, '../../layout/.cache/plugins.local.css');
    if (!fs.existsSync(css)) return; // layout suite has not fetched it here
    const text = fs.readFileSync(css, 'utf-8');
    const src = fs.readFileSync(path.join(__dirname, '../../../tools/config-editor.html'), 'utf-8');
    const table = src.slice(src.indexOf('var MODELS = {'), src.indexOf('};', src.indexOf('var MODELS = {')));
    const classes = new Set([...table.matchAll(/classes:\s*"([^"]+)"/g)].flatMap((m) => m[1].split(' ')));
    classes.add('screen--portrait');
    // The density classes come with every model in the API and no rule uses them.
    classes.forEach((c) => assert(/^screen--density-/.test(c) || text.indexOf('.' + c) >= 0, 'the framework has no ' + c));
  });

  test('the page nav follows the page, and every section id is still reachable', () => {
    const { document } = loadEditor();
    const hrefs = [...document.querySelectorAll('.mc-top nav a')]
      .map((a) => a.getAttribute('href')).filter((hr) => hr.charAt(0) === '#');
    assertEqual(hrefs, ['#station-wizard', '#station-demo', '#station-start', '#station-agent',
      '#station-calendars', '#station-lines', '#station-output']);
    // ids are load-bearing: they are what the nav, the docs and every deep link point at
    hrefs.forEach((hr) => assert(document.querySelector(hr), 'nav points at a section that is not there: ' + hr));
  });
};
