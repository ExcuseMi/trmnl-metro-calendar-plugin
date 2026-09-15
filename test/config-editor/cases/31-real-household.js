'use strict';

// A REAL HOUSEHOLD, BUILT BY HAND. What a tester ran into setting up a family
// of four with Nextcloud, Outlook and Google calendars: a holiday feed that
// became a line called basic.ics, a guess fooled by the account name
// Nextcloud writes after every shared calendar, an Undo button that pushed
// the bar onto two rows, and host names where calendar names belong.

const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '../../..');

const HOLIDAYS = 'https://calendar.google.com/calendar/ical/nl.be%23holiday%40group.v.calendar.google.com/public/basic.ics';

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, jsonOut, assert, assertEqual } = h;
  const template = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve(fs.readFileSync(path.join(REPO, 'plugin/src/shared.liquid'), 'utf-8')) });
  function ics(name, title) {
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:' + name,
      'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:' + (title || 'Practice'), 'DTSTART:20991103T160000', 'DTEND:20991103T170000', 'END:VEVENT',
      'END:VCALENDAR', ''].join('\r\n');
  }
  const wzBody = (document) => document.getElementById('wzBody');
  const q = (document) => document.getElementById('wzQ').textContent;
  const next = (document) => document.getElementById('wzNext');
  async function check(document, url) {
    fireInput(document.getElementById('wzUrl'), url);
    click(h.buttonByText(wzBody(document), 'Check this link'));
    await h.flush();
  }

  // ---- 2. a Google holiday link in the full editor ------------------------

  test('a holiday link added for nobody is a holiday feed, called after its country', () => {
    const { document } = loadEditor(undefined, '?full');
    const card = h.addFeed(document, HOLIDAYS);
    assertEqual(jsonOut(document).calendars, [{ url: HOLIDAYS, holiday: true }]);
    assert(/Public holidays \(Belgium\)/.test(card.querySelector('.cal-title').textContent),
      'the card is not called after the holidays: ' + card.querySelector('.cal-title').textContent);
    assert(!/basic\.ics/.test(card.querySelector('.cal-title').textContent));
    assert(/Public holidays \(Belgium\)/.test(document.getElementById('addStatus').textContent), document.getElementById('addStatus').textContent);
  });

  test('a holiday link put on somebody\'s line says what that costs, and one press fixes it', () => {
    const { document } = loadEditor(undefined, '?full');
    const card = h.addFeed(document, HOLIDAYS, 'Alex');
    const warn = card.querySelector('.cal-holiday-warn');
    assert(/beside the date/.test(warn.textContent) && /Alex's line they take room on the map/.test(warn.textContent),
      'no warning for a holiday feed routed onto a line: ' + warn.textContent);
    click(card.querySelector('.cal-holiday-fix'));
    assertEqual(jsonOut(document).calendars, [{ url: HOLIDAYS, holiday: true }]);
    assert(!document.querySelector('#calendars .cal-holiday-warn button'), 'the warning stayed after the fix');
  });

  test('a pasted configuration keeps what it says, and the card suggests the fix', () => {
    const { document } = loadEditor();
    const cfg = { calendars: [{ url: HOLIDAYS }] };
    document.getElementById('importIn').value = JSON.stringify(cfg);
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).calendars, cfg.calendars, 'loading changed the configuration it was given');
    const warn = document.querySelector('#calendars .cal-holiday-warn');
    assert(/everyone's line/.test(warn.textContent) && warn.querySelector('button'), warn.textContent);
    // a plain list of links is new work, so the holiday one is marked
    document.getElementById('importIn').value = HOLIDAYS + '\nhttps://cal.example.com/sam.ics';
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document).calendars, [{ url: HOLIDAYS, holiday: true }, { url: 'https://cal.example.com/sam.ics' }]);
  });

  // ---- 4. "(owner)" after every Nextcloud feed ---------------------------

  test('the account name Nextcloud writes after a shared calendar is not a guess at whose it is', async () => {
    const feeds = {
      'https://cloud.example.dev/remote.php/dav/public-calendars/aaa?export': ics('Family (jules)', 'Dinner'),
      'https://cloud.example.dev/remote.php/dav/public-calendars/bbb?export': ics('Work (jules)', 'Standup'),
    };
    const direct = (url) => {
      const u = String(url);
      if (/shared\.liquid$/.test(u)) return template();
      if (feeds[u]) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(feeds[u]) });
      return Promise.reject(new Error('Failed to fetch'));
    };
    const { document } = loadEditor(direct);
    click(document.getElementById('wzStart'));
    fireInput(document.getElementById('wzName0'), 'Jules');
    click(h.buttonByText(wzBody(document), 'Add another person'));
    fireInput(document.getElementById('wzName1'), 'Sam');
    click(next(document));
    click(document.getElementById('wzShapeShared'));
    click(document.getElementById('wzForAll'));
    await check(document, 'https://cloud.example.dev/remote.php/dav/public-calendars/aaa?export');
    assert(document.querySelector('#wzBody .wz-proof'), 'the shared feed was not read');
    assert(!document.getElementById('wzWhoGuess'), 'the "(jules)" Nextcloud writes after it was taken for Jules\'s: '
      + wzBody(document).textContent);
    assert(/Add it to everybody's line/.test(next(document).textContent), next(document).textContent);
  });

  test('a calendar is called by its own name without the account after it', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = 'https://cloud.example.dev/remote.php/dav/public-calendars/aaa?export';
    click(document.getElementById('loadImport'));
    // what a read feed calls itself, as the page would hold it
    const u = 'https://cloud.example.dev/remote.php/dav/public-calendars/aaa?export';
    const sources = document.querySelector('#sources textarea[data-feed]');
    sources.value = ics('Family (jules)', 'Dinner');
    sources.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    fireInput(document.querySelector('#calendars .who-input'), 'Jules');
    h.fireChange(document.querySelector('#calendars .who-input'));
    const said = document.querySelector('#lines .line-feeds').textContent;
    assert(/From Family$/.test(said.trim()), said + ' (' + u + ')');
    assert(/^Family$/.test(document.querySelector('#calendars .cal-title').textContent) || /Jules/.test(document.querySelector('#calendars .cal-title').textContent));
  });

  // ---- 5. Undo stays short -----------------------------------------------

  test('the Undo button says what it undoes in a few words, with the rest on hover', () => {
    const { document } = loadEditor(undefined, '?full');
    h.addFeed(document, 'https://cal.example.com/sam.ics', 'Sam');
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'Gym');
    fireInput(rule.querySelector('.cond input[type=text]'));
    h.selectMulti(rule.querySelector('.line-picker'), ['Sam']);
    const undo = document.getElementById('undoBtn');
    assert(undo.textContent.length <= 36, 'the Undo button grew to ' + undo.textContent.length + ' characters: ' + undo.textContent);
    assert(/^Undo: /.test(undo.title) && undo.title.length >= undo.textContent.length, undo.title);
  });

  // ---- 6. calendar names, not host names ---------------------------------

  test('a person\'s card names their calendars the way the setup does, never by file or host', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Quinn' }],
      calendars: [
        { url: 'https://cloud.example.dev/remote.php/dav/public-calendars/x1?export', name: 'Quinn', line: 'Quinn' },
        { url: 'https://outlook.office365.com/owa/calendar/abc/reachcalendar.ics', name: 'Quinn', line: 'Quinn' },
        { url: HOLIDAYS, line: 'Quinn' },
      ],
    });
    click(document.getElementById('loadImport'));
    const said = document.querySelector('#lines .line-feeds').textContent;
    assert(/From 3 calendars: Nextcloud, Outlook, Public holidays \(Belgium\)/.test(said), said);
  });

  // ---- the rule card -----------------------------------------------------

  test('a rule puts an event on people by ticking them, with no ctrl-click list', () => {
    const { document } = loadEditor(undefined, '?full');
    h.addFeed(document, 'https://cal.example.com/sam.ics', 'Sam');
    h.addFeed(document, 'https://cal.example.com/alex.ics', 'Alex');
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    assert(!rule.querySelector('select[multiple]'), 'the multi-select is back');
    const ticks = [...rule.querySelectorAll('.line-picker input[type=checkbox]')];
    assertEqual(ticks.map((b) => b.value), ['Sam', 'Alex']);
    fireInput(rule.querySelector('.cond-value'), 'Swim');
    h.selectMulti(rule.querySelector('.line-picker'), ['Sam', 'Alex']);
    assertEqual(jsonOut(document).rules[0].line, ['Sam', 'Alex']);
  });

  test('a rule naming a line leaves the title alone, and there is no rename box to tick', () => {
    const { document } = loadEditor(undefined, '?full');
    h.addFeed(document, 'https://cal.example.com/sam.ics', 'Sam');
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond-value'), 'L2');
    h.selectMulti(rule.querySelector('.line-picker'), ['Sam']);
    assert(![...rule.querySelectorAll('label.check')].some((l) => /replace the matched text with their name/.test(l.textContent)), 'the rename box is back');
    assertEqual(jsonOut(document).rules, [{ match: { type: 'word', value: 'L2' }, line: 'Sam' }]);
    const cfg = { lines: [{ name: 'Sam' }], rules: [{ match: { type: 'word', value: 'L2' }, line: 'Sam' }],
      calendars: [{ url: 'https://cal.example.com/sam.ics' }] };
    document.getElementById('importIn').value = JSON.stringify(cfg);
    click(document.getElementById('loadImport'));
    assertEqual(jsonOut(document), cfg);
  });

};
