'use strict';

// SEVERAL CALENDARS A PERSON, AND SHARED WITH SOME OF US.
//
// Work, school and a club are three calendars for one person, and the school
// run is shared by two of four. The wizard used to take one link per person
// and treat anything shared as the whole house's. These cases walk both, read
// the JSON they write, and hand it to the plugin's own parseConfig to see the
// appointments land on the right people.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../../..');

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, jsonOut, assert, assertEqual } = h;

  function ics(name) {
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:' + name,
      'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:Practice', 'DTSTART:20991103T160000', 'DTEND:20991103T170000', 'END:VEVENT',
      'END:VCALENDAR', ''].join('\r\n');
  }
  // Every .ics answers, calling itself after its file name, so no feed looks
  // like anybody's and the "whose is this?" question never gets in the way.
  function direct(url) {
    const u = String(url);
    if (/shared\.liquid$/.test(u)) {
      return Promise.resolve({ ok: true, status: 200,
        text: () => Promise.resolve(fs.readFileSync(path.join(REPO, 'plugin/src/shared.liquid'), 'utf-8')) });
    }
    const m = /\/([a-z-]+)\.ics$/.exec(u);
    if (m) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ics('Feed ' + m[1])) });
    return Promise.reject(new Error('Failed to fetch'));
  }
  const q = (document) => document.getElementById('wzQ').textContent;
  const lede = (document) => document.getElementById('wzLede').textContent;
  const said = (document) => document.getElementById('wzStatus').textContent;
  const next = (document) => document.getElementById('wzNext');
  const wzBody = (document) => document.getElementById('wzBody');
  const settle = () => new Promise((r) => setTimeout(r, 320));
  function start(document, names, shape) {
    click(document.getElementById('wzStart'));
    names.forEach((n, i) => {
      if (i > 0) click(h.buttonByText(wzBody(document), 'Add another person'));
      fireInput(document.getElementById('wzName' + i), n);
    });
    click(next(document));
    click(document.getElementById('wzShape' + shape));
  }
  async function check(document, url) {
    fireInput(document.getElementById('wzUrl'), url);
    click(h.buttonByText(wzBody(document), 'Check this link'));
    await h.flush();
  }
  function tick(document, names) {
    [...document.querySelectorAll('#wzBody .wz-ticks input')].forEach((b) => { b.checked = names.indexOf(b.value) !== -1; });
  }
  // Where the plugin puts an appointment from calendar `i` of this JSON.
  function routed(window, text, i) {
    const p = window.parseConfig(text);
    const r = window.applyCalendarRules({ title: 'Practice' }, 2, p.calendars[i], p.globalRules, p.everyoneLine);
    return r.lineNames ? [].concat(r.lineNames) : null;
  }

  // ---- more than one calendar for a person -----------------------------

  test('a person can have several calendars, added one after another on their screen', async () => {
    const { window, document } = loadEditor(direct);
    start(document, ['Alex', 'Sam'], 'Each');
    await check(document, 'https://cal.example.com/alex-work.ics');
    const more = document.getElementById('wzAddMore');
    assert(more && /Add another calendar for Alex/.test(more.textContent), 'no way to add a second calendar for Alex');
    click(more);
    assertEqual(jsonOut(document).calendars.length, 1, 'the first calendar was not added before asking for the next');
    assert(/where is Alex's other calendar/i.test(q(document)), 'it did not ask for Alex\'s next one: ' + q(document));
    assert(/Feed alex-work/.test(lede(document)), 'it does not say what Alex has in already: ' + lede(document));
    assert(/next one for Alex/.test(said(document)), said(document));
    await check(document, 'https://cal.example.com/alex-club.ics');
    click(document.getElementById('wzAddMore'));
    await check(document, 'https://cal.example.com/alex-school.ics');
    click(next(document));
    // a second or third calendar in is a moment to say that is all of them
    assert(/where is Alex's other calendar/i.test(q(document)), 'it moved on without asking: ' + q(document));
    assert(/That is all of Alex's calendars/.test(next(document).textContent), next(document).textContent);
    click(next(document));
    assert(/where is Sam's calendar/i.test(q(document)), 'it did not move on to Sam: ' + q(document));

    const text = document.getElementById('jsonOut').value;
    const alex = (u) => ({ url: u, name: 'Alex', line: 'Alex' });
    assertEqual(JSON.parse(text).calendars, [alex('https://cal.example.com/alex-work.ics'),
      alex('https://cal.example.com/alex-club.ics'), alex('https://cal.example.com/alex-school.ics')]);
    [0, 1, 2].forEach((i) => assertEqual(routed(window, text, i), ['Alex']));

    // Back to Alex, and nothing already in is lost or asked for twice
    click(document.getElementById('wzBack'));
    assert(/where is Alex's other calendar/i.test(q(document)), q(document));
    assertEqual(jsonOut(document).calendars.length, 3);
  });

  test('with a calendar in, moving on is an answer, and a link left in the box is not dropped silently', async () => {
    const { document } = loadEditor(direct);
    start(document, ['Alex', 'Sam'], 'Each');
    await check(document, 'https://cal.example.com/alex.ics');
    click(document.getElementById('wzAddMore'));
    assert(!next(document).hidden && /That is all of Alex's calendars/.test(next(document).textContent),
      'there is no way on from the second link screen: ' + next(document).textContent);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex-two.ics');
    click(next(document));
    assert(/has not been added/.test(said(document)), 'a typed link was thrown away: ' + said(document));
    fireInput(document.getElementById('wzUrl'), '');
    click(next(document));
    assert(/where is Sam's calendar/i.test(q(document)), q(document));
    assertEqual(jsonOut(document).calendars.length, 1);
  });

  test('carrying on later keeps every calendar a person has and the screen they were on', async () => {
    const first = loadEditor(direct);
    start(first.document, ['Alex', 'Sam'], 'Each');
    await check(first.document, 'https://cal.example.com/alex.ics');
    click(first.document.getElementById('wzAddMore'));
    await check(first.document, 'https://cal.example.com/alex-club.ics');
    click(first.document.getElementById('wzAddMore'));
    await settle();
    const stored = first.window.localStorage.getItem('metro-calendar-setup-v1');

    const { window, document } = loadEditor();
    window.localStorage.setItem('metro-calendar-setup-v1', stored);
    click(document.querySelector('.mc-top nav a[href="#station-wizard"]'));
    click(document.getElementById('wzResume'));
    assertEqual(jsonOut(document).calendars.map((c) => c.url),
      ['https://cal.example.com/alex.ics', 'https://cal.example.com/alex-club.ics']);
    assert(/where is Alex's other calendar/i.test(q(document)), 'it did not carry on where it stopped: ' + q(document));
    click(next(document));
    assert(/where is Sam's calendar/i.test(q(document)), 'the rest of the walk was lost: ' + q(document));
  });

  // ---- shared: everyone, or just some of us ----------------------------

  test('a calendar for just some of us goes to those people and nobody else', async () => {
    const { window, document } = loadEditor(direct);
    start(document, ['Alex', 'Sam', 'Quinn'], 'Shared');
    assert(/who is this calendar for/i.test(q(document)), q(document));
    click(document.getElementById('wzForSome'));
    assertEqual([...document.querySelectorAll('#wzBody .wz-ticks label')].map((l) => l.textContent), ['Alex', 'Sam', 'Quinn']);
    click(next(document));
    assert(/at least one name/.test(said(document)), 'nobody ticked was let through: ' + said(document));
    tick(document, ['Alex', 'Sam']);
    click(next(document));
    assert(/where is the calendar Alex and Sam share/i.test(q(document)), q(document));
    await check(document, 'https://cal.example.com/school-run.ics');
    assert(/Add it for Alex and Sam/.test(next(document).textContent), next(document).textContent);
    click(next(document));

    const text = document.getElementById('jsonOut').value;
    assertEqual(JSON.parse(text).calendars, [{ url: 'https://cal.example.com/school-run.ics',
      line: ['Alex', 'Sam'] }]);
    assertEqual(routed(window, text, 0), ['Alex', 'Sam'], 'the plugin does not send it to just those two');

    // another one from "anything else?", and Back from its link screen
    // returns to the question, still answered
    assert(/anything else/i.test(q(document)), q(document));
    click(document.getElementById('wzAddShared'));
    click(document.getElementById('wzForSome'));
    tick(document, ['Quinn']);
    click(next(document));
    click(document.getElementById('wzBack'));
    assert(/who is this calendar for/i.test(q(document)), q(document));
    assertEqual([...document.querySelectorAll('#wzBody .wz-ticks input')].filter((b) => b.checked).map((b) => b.value), ['Quinn']);
  });

  test('just one person ticked is that person\'s calendar, and everybody ticked is the whole house', async () => {
    const { window, document } = loadEditor(direct);
    start(document, ['Alex', 'Sam'], 'Shared');
    click(document.getElementById('wzForSome'));
    tick(document, ['Sam']);
    click(next(document));
    await check(document, 'https://cal.example.com/sam-club.ics');
    click(document.getElementById('wzAddMore'));
    assert(/who is this calendar for/i.test(q(document)), 'another shared calendar did not ask again: ' + q(document));
    click(document.getElementById('wzForSome'));
    tick(document, ['Alex', 'Sam']);
    click(next(document));
    await check(document, 'https://cal.example.com/house.ics');
    click(next(document));
    const text = document.getElementById('jsonOut').value;
    assertEqual(JSON.parse(text).calendars, [
      { url: 'https://cal.example.com/sam-club.ics', name: 'Sam', line: 'Sam' },
      { url: 'https://cal.example.com/house.ics' },
    ]);
    assertEqual(routed(window, text, 0), ['Sam']);
    assertEqual([].concat(window.parseConfig(text).allLines), ['Alex', 'Sam']);
  });

  test('a "just some of us" answer survives closing the tab', async () => {
    const first = loadEditor(direct);
    start(first.document, ['Alex', 'Sam', 'Quinn'], 'Mix');
    // skip the three people to reach the shared question
    for (let i = 0; i < 3; i++) click(first.document.getElementById('wzSkip'));
    click(first.document.getElementById('wzForSome'));
    tick(first.document, ['Sam', 'Quinn']);
    click(next(first.document));
    await settle();
    const stored = first.window.localStorage.getItem('metro-calendar-setup-v1');
    const { window, document } = loadEditor(direct);
    window.localStorage.setItem('metro-calendar-setup-v1', stored);
    click(document.querySelector('.mc-top nav a[href="#station-wizard"]'));
    click(document.getElementById('wzResume'));
    assert(/where is the calendar Sam and Quinn share/i.test(q(document)), q(document));
    await check(document, 'https://cal.example.com/club.ics');
    click(next(document));
    assertEqual(jsonOut(document).calendars, [{ url: 'https://cal.example.com/club.ics',
      line: ['Sam', 'Quinn'] }]);
  });

  // ---- the list on the board screen ------------------------------------

  const REOPEN = {
    lines: [{ name: 'Alex' }, { name: 'Sam' }, { name: 'Jules' }],
    calendars: [
      { url: 'https://calendar.google.com/calendar/ical/alex%40example.com/private-x/basic.ics', name: 'Alex',
        line: 'Alex' },
      { url: 'https://cloud.example.dev/remote.php/dav/public-calendars/abc?export', name: 'Alex',
        line: 'Alex' },
      { url: 'https://p01-caldav.icloud.com/published/2/xyz', line: ['Alex', 'Sam'] },
      { url: 'https://cal.example.org/house.ics' },
    ],
  };
  function reopen(document) {
    click(document.getElementById('wzReopen'));
    document.getElementById('wzPaste').value = JSON.stringify(REOPEN);
    click(h.buttonByText(wzBody(document), 'Read it and fill in my answers'));
  }
  const groups = (document) => [...document.querySelectorAll('#wzBody .wz-group')];

  test('the board lists calendars under each person by names a person knows, and shared ones by who sees them', () => {
    const { document } = loadEditor();
    reopen(document);
    assert(/here is your board/i.test(q(document)), q(document));
    const g = groups(document);
    assertEqual(g.map((x) => x.querySelector('h3').textContent), ['Alex', 'Sam', 'Jules', 'Shared']);
    const alex = g[0];
    assertEqual([...alex.querySelectorAll('.wz-cal .what')].map((x) => x.textContent), ['Google Calendar', 'Nextcloud']);
    assertEqual(alex.querySelectorAll('button').length, 3, 'one add for Alex and a Remove per calendar');
    assertEqual([...alex.querySelectorAll('button')].filter((b) => /Add another calendar for Alex/.test(b.textContent)).length, 1);
    assertEqual(alex.querySelectorAll('button[aria-label="Remove Nextcloud from Alex"]').length, 1);
    // the link is there for anybody who needs to check it, folded away
    const link = alex.querySelector('.wz-cal details.wz-url');
    assert(link && !link.open && /basic\.ics/.test(link.textContent), 'the link is not available on demand');
    const visible = [...alex.querySelectorAll('.wz-cal .what, .wz-cal .note')].map((x) => x.textContent).join(' ');
    assert(!/\.ics|example\.dev|basic/.test(visible), 'a piece of the link is shown as the name: ' + visible);

    assert(/No calendar yet/.test(g[2].textContent) && /Add a calendar for Jules/.test(g[2].textContent), g[2].textContent);
    const shared = g[3].textContent;
    assert(/iCloud/.test(shared) && /Alex and Sam see this/.test(shared), shared);
    assert(/the calendar at example\.org/.test(shared) && /Everyone in the house sees this/.test(shared), shared);
    assert(!/every line/.test(document.getElementById('wzBody').textContent), 'the board still says "every line"');
    assertEqual((shared.match(/Add another shared calendar/g) || []).length, 1);
  });

  test('Remove takes one calendar, not the person\'s lot, and says which', () => {
    const { document } = loadEditor();
    reopen(document);
    const alex = groups(document)[0];
    click(alex.querySelector('button[aria-label="Remove Google Calendar from Alex"]'));
    const urls = jsonOut(document).calendars.map((c) => c.url);
    assertEqual(urls.length, 3, 'more than the one calendar was removed');
    assert(urls.some((u) => /remote\.php/.test(u)), 'Alex\'s other calendar went too');
    assert(/Removed Google Calendar/.test(said(document)), said(document));
  });

  test('who sees a shared calendar can be changed from the board', () => {
    const { window, document } = loadEditor();
    reopen(document);
    const change = groups(document)[3].querySelector('button[aria-label="Change who sees iCloud"]');
    assert(change, 'there is no way to change who sees a shared calendar');
    click(change);
    assert(/who sees iCloud/i.test(q(document)), q(document));
    assertEqual([...document.querySelectorAll('#wzBody .wz-ticks input')].filter((b) => b.checked).map((b) => b.value), ['Alex', 'Sam'],
      'the answer already in is not the one shown');
    tick(document, ['Sam', 'Jules']);
    click(next(document));
    assert(/here is your board/i.test(q(document)), q(document));
    let text = document.getElementById('jsonOut').value;
    assertEqual(JSON.parse(text).calendars[2].line, ['Sam', 'Jules']);
    assertEqual(routed(window, text, 2), ['Sam', 'Jules']);
    click(groups(document)[3].querySelector('button[aria-label="Change who sees iCloud"]'));
    click(document.getElementById('wzForAll'));
    text = document.getElementById('jsonOut').value;
    assertEqual(JSON.parse(text).calendars[2], { url: 'https://p01-caldav.icloud.com/published/2/xyz' });
    assert(/Everyone in the house/.test(said(document)), said(document));
  });

  test('a calendar that has been read is listed by the name it gives itself', async () => {
    const { document } = loadEditor(direct);
    start(document, ['Alex'], 'Each');
    await check(document, 'https://cal.example.com/alex.ics');
    click(next(document));
    click(next(document));
    const what = [...document.querySelectorAll('#wzBody .wz-group .wz-cal .what')].map((x) => x.textContent);
    assertEqual(what, ['Feed alex']);
  });

  test('the new questions use no machinery words either', async () => {
    const { document } = loadEditor(direct);
    const seen = [];
    const grab = () => seen.push(q(document) + ' ' + lede(document) + ' ' + wzBody(document).textContent + ' '
      + next(document).textContent + ' ' + said(document));
    start(document, ['Alex', 'Sam'], 'Mix');
    await check(document, 'https://cal.example.com/alex.ics');
    grab();
    click(document.getElementById('wzAddMore'));
    grab();
    click(next(document));
    click(document.getElementById('wzSkip'));
    grab();
    click(document.getElementById('wzForSome'));
    grab();
    tick(document, ['Sam']);
    click(next(document));
    grab();
    click(document.getElementById('wzSkip'));
    grab();
    click(next(document));
    grab();
    const text = seen.join('\n');
    [/\brules?\b/i, /\btracks?\b/i, /\bJSON\b/, /\bconfig\b/i].forEach((rx) => {
      assert(!rx.test(text), 'the wizard says ' + rx + ' in: ' + (text.split('\n').find((s) => rx.test(s)) || '').slice(0, 200));
    });
  });
};
