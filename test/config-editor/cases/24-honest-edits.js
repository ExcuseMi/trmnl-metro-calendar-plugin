'use strict';

// WHAT THE PAGE SAYS IT DID HAS TO BE WHAT IT DID.
//
// A round of bugs a tester found, each one the page claiming something that
// was not so: a file "lets this page show you the board" and the board said
// the feed could not be read; "Added to Alex's line" over a calendar with no
// link, which the configuration drops; a removed person whose feed quietly
// went onto everybody's line; an Undo that named a load and threw away the
// rename made after it; a Now of 21:00 that drew 15:00.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../../..');

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, fireChange, jsonOut, assert, assertEqual } = h;

  const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Alex',
    'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:Swimming', 'DTSTART:20260915T160000', 'DTEND:20260915T170000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');
  const template = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve(fs.readFileSync(path.join(REPO, 'plugin/src/shared.liquid'), 'utf-8')) });
  // The calendar refuses a web page, and so does the helper server.
  function noFeeds(url) {
    return /shared\.liquid$/.test(String(url)) ? template() : Promise.reject(new Error('Failed to fetch'));
  }
  function direct(url) {
    const u = String(url);
    if (/shared\.liquid$/.test(u)) return template();
    if (/\.ics$/.test(u)) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ICS) });
    return Promise.reject(new Error('Failed to fetch'));
  }
  const q = (document) => document.getElementById('wzQ').textContent;
  const said = (document) => document.getElementById('wzStatus').textContent;
  const next = (document) => document.getElementById('wzNext');
  function people(document, names) {
    click(document.getElementById('wzStart'));
    names.forEach((n, i) => {
      if (i > 0) click(h.buttonByText(document.getElementById('wzBody'), 'Add another person'));
      fireInput(document.getElementById('wzName' + i), n);
    });
    click(next(document));
  }
  async function upload(window, document, text) {
    const file = document.getElementById('wzFile');
    Object.defineProperty(file, 'files', { value: [new window.File([text], 'alex.ics')] });
    file.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));   // FileReader is asynchronous
  }
  async function checkLink(document, url) {
    fireInput(document.getElementById('wzUrl'), url);
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
  }

  // ---- 1. the file handed over is what the board draws -----------------

  test('a file handed over instead of the relay is what the board draws', async () => {
    const { window, document } = loadEditor(noFeeds);
    people(document, ['Alex']);
    click(document.getElementById('wzShapeEach'));
    await checkLink(document, 'https://cal.example.com/alex.ics');
    click(document.getElementById('wzRelayNo'));
    await upload(window, document, ICS);
    assert(/Add it to Alex's line/.test(next(document).textContent), 'sanity: the file was read');
    click(next(document));
    await h.flush();
    assertEqual(jsonOut(document).calendars.map((c) => c.url), ['https://cal.example.com/alex.ics']);
    const box = document.querySelector('#sources textarea[data-feed="https://cal.example.com/alex.ics"]');
    assert(box && box.value.replace(/\r/g, '') === ICS.replace(/\r/g, ''), 'the file was not kept as that feed\'s text: ' + (box && box.value));
    const status = document.getElementById('previewStatus').textContent;
    assert(!/could not be read/.test(status), 'the board still says the feed could not be read: ' + status);
  });

  // ---- 2. no link, no "Added" ------------------------------------------

  test('a file with no link is not "added", and the link is asked for', async () => {
    const { window, document } = loadEditor(noFeeds);
    people(document, ['Alex']);
    click(document.getElementById('wzShapeEach'));
    await upload(window, document, ICS);
    click(next(document));
    assert(!jsonOut(document).calendars.length && !document.querySelector('#calendars .card'), 'a calendar with no link was added');
    assert(/Not added/.test(said(document)) && /link/.test(said(document)),
      'it did not say the link is still needed: ' + said(document));
    assert(/where is Alex's calendar/i.test(q(document)), 'it moved on without the link');

    // the file is still there once the link arrives
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(next(document));
    await h.flush();
    assertEqual(jsonOut(document).calendars.length, 1);
    const box = document.querySelector('#sources textarea[data-feed="https://cal.example.com/alex.ics"]');
    assert(box && box.value.replace(/\r/g, '') === ICS.replace(/\r/g, ''), 'the file was lost while the link was typed');
  });

  // ---- 3. somebody forgotten is one more question ----------------------

  test('somebody forgotten is asked about on their own', async () => {
    const { document } = loadEditor(direct);
    people(document, ['Alex']);
    assert(/You named Alex\./.test(document.getElementById('wzLede').textContent));
    click(document.getElementById('wzShapeEach'));
    await checkLink(document, 'https://cal.example.com/alex.ics');
    click(next(document));
    assert(/anything else/i.test(q(document)), 'sanity: on to extras: ' + q(document));

    click(document.getElementById('wzAddPerson'));
    click(h.buttonByText(document.getElementById('wzBody'), 'Add another person'));
    fireInput(document.getElementById('wzName1'), 'Sam');
    click(next(document));
    assert(/where is Sam's calendar/i.test(q(document)),
      'adding a forgotten person did not go straight to their link: ' + q(document));
    click(document.getElementById('wzBack'));
    assert(/how are your calendars arranged/i.test(q(document)), 'sanity: back to the arrangement');
    assert(/You named Alex and Sam\./.test(document.getElementById('wzLede').textContent),
      'the names are not read out as a list: ' + document.getElementById('wzLede').textContent);
    // and answering it again asks only for what is missing
    click(document.getElementById('wzShapeEach'));
    assert(/where is Sam's calendar/i.test(q(document)), 'it asked for Alex\'s link again: ' + q(document));
  });

  // ---- 4. a person's own calendar goes with them -----------------------

  test('taking somebody off the list in the wizard takes their own calendar too', async () => {
    const { document } = loadEditor(direct);
    people(document, ['Alex', 'Sam']);
    click(document.getElementById('wzShapeEach'));
    await checkLink(document, 'https://cal.example.com/alex.ics');
    click(next(document));
    await checkLink(document, 'https://cal.example.com/sam.ics');
    // the feed calls itself Alex, so the page asks whose it really is
    click(document.getElementById('wzWhoExpected'));
    click(next(document));
    assertEqual(jsonOut(document).calendars.length, 2, 'sanity: both calendars are in');

    click(document.getElementById('wzAddPerson'));
    const remove = [...document.querySelectorAll('#wzBody .wz-people button')]
      .find((b) => /Sam/.test(b.getAttribute('aria-label') || ''));
    click(remove);
    click(next(document));
    const out = jsonOut(document);
    assertEqual(out.calendars.map((c) => c.url), ['https://cal.example.com/alex.ics'],
      'Sam\'s calendar stayed with nobody named on it, so it would show on every line');
    assert(/sam\.ics went too/.test(said(document)) && /Undo/.test(said(document)),
      'nothing said the calendar went as well: ' + said(document));
  });

  test('a calendar shared with somebody still here stays when one of them goes', () => {
    const { document } = loadEditor();
    h.addFeed(document, 'https://a.example/both.ics', 'Quinn, Jules');
    click([...document.querySelectorAll('#lines .card')][0].querySelector('button[title="Remove this person"]'));
    assertEqual(jsonOut(document).calendars, [{ url: 'https://a.example/both.ics',
      line: 'Jules' }]);
  });

  // ---- 5. every edit is its own undo step ------------------------------

  test('undo takes back a rename, and only the rename', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Priya' }],
      calendars: [{ url: 'https://a.example/p.ics', name: 'Priya', line: 'Priya' }],
    });
    click(document.getElementById('loadImport'));
    const loaded = document.getElementById('jsonOut').value;
    const field = document.querySelector('#lines .card .title-input');
    fireInput(field, 'Pri');
    fireInput(field, 'Priyanka');
    fireChange(field);
    const undo = document.getElementById('undoBtn');
    assert(!/load the pasted/.test(undo.textContent), 'Undo would throw away the load, not the rename: ' + undo.textContent);
    click(undo);
    assertEqual(document.getElementById('jsonOut').value, loaded, 'undo did not put the old name back in one step');
    assert(/load the pasted/.test(undo.textContent), 'the load is the next thing to undo: ' + undo.textContent);
  });

  test('undo takes back a ticked box on a rule without losing what came before it', () => {
    const { document } = loadEditor();
    h.addFeed(document, 'https://a.example/sam.ics', 'Sam');
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'Dentist');
    const hide = h.checkByLabel(rule, 'hide it from the map');
    hide.checked = true;
    fireChange(hide);
    assert(jsonOut(document).rules[0].hide, 'sanity: the rule hides');
    click(document.getElementById('undoBtn'));
    assertEqual(jsonOut(document).calendars.length, 1, 'undo threw away the calendar added before the tick');
    const r = document.querySelector('#globalRules .rule');
    assert(r && r.querySelector('.cond input[type=text]').value === 'Dentist', 'undo threw away the typed word too');
    assert(!h.checkByLabel(r, 'hide it from the map').checked, 'the tick was not taken back');
  });

  // ---- 6. a word after the link ----------------------------------------

  test('a link list reads "holiday" after a link the way the plugin does', () => {
    const { window, document } = loadEditor();
    const text = 'https://a.example/basic.ics holiday\nhttps://a.example/sam.ics';
    document.getElementById('importIn').value = text;
    click(document.getElementById('loadImport'));
    const plugin = JSON.parse(JSON.stringify(window.parseConfig(text).calendars.map((c) => ({ url: c.url, holiday: c.holiday }))));
    assertEqual(plugin, [{ url: 'https://a.example/basic.ics', holiday: true }, { url: 'https://a.example/sam.ics', holiday: false }]);
    assertEqual(jsonOut(document).calendars, [{ url: 'https://a.example/basic.ics', holiday: true }, { url: 'https://a.example/sam.ics' }],
      'the editor kept the word as part of the link');
  });

  test('the add-calendar box reads "holiday" after a link too', () => {
    const { document } = loadEditor();
    h.addFeed(document, 'https://x.example/hols.ics holiday', '');
    assertEqual(jsonOut(document).calendars, [{ url: 'https://x.example/hols.ics', holiday: true }]);
  });

  // ---- 7. Now is on the board's clock ----------------------------------

  test('Now means that time in the zone the board is drawn in', async () => {
    const { window, document } = loadEditor(direct);
    document.getElementById('importIn').value = JSON.stringify({ timeZone: 'Pacific/Kiritimati', calendars: ['https://a.example/x.ics'] });
    click(document.getElementById('loadImport'));
    fireInput(document.getElementById('pNow'), '21:00');
    let seen = null;
    window.run = (input) => { seen = input; return Promise.reject(new Error('stopped by the test')); };
    click(document.getElementById('runPreview'));
    await h.flush();
    assert(seen, 'sanity: the preview ran');
    const at = new Date(seen.trmnl.system.timestamp_utc * 1000);
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Pacific/Kiritimati', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
    assertEqual(hm, '21:00');
  });

  // ---- 8. holidays can be said in the full editor ----------------------

  test('a calendar and a rule can each be marked as a holiday', () => {
    const { document } = loadEditor();
    const card = h.addFeed(document, 'https://a.example/hols.ics', '');
    const box = h.checkByLabel(card, 'holiday feed');
    box.checked = true;
    fireChange(box);
    assertEqual(jsonOut(document).calendars[0].holiday, true);

    click(h.buttonByText(card, '+ Add a rule'));
    const rule = card.querySelector('.rule');
    fireInput(rule.querySelector('.cond input[type=text]'), 'Leave');
    const rh = h.checkByLabel(rule, 'it is a holiday');
    rh.checked = true;
    fireChange(rh);
    assertEqual(jsonOut(document).calendars[0].rules, [{ match: { type: 'word', value: 'Leave' }, holiday: true }]);

    assert(/"holiday"/.test(document.getElementById('schemaRef').textContent), 'the schema does not mention holiday');
    click(document.getElementById('makePrompt'));
    assert(/`"holiday": true`/.test(document.getElementById('promptOut').value), 'the prompt does not mention holiday');
  });
};
