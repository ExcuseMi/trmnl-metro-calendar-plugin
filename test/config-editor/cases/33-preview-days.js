'use strict';

// OTHER DAYS, NOT ONLY OTHER HOURS. The feeds hold every date and the plugin
// picks the day out of the timestamp, so Previous and Next day are another
// timestamp and a redraw from what is already read: the same wall time on
// the board's calendar, which across a clock change is 23 or 25 hours.

const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '../../..');

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, assert, assertEqual } = h;
  const ZONE = 'Europe/Brussels';
  const template = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve(fs.readFileSync(path.join(REPO, 'plugin/src/shared.liquid'), 'utf-8')) });
  const FEED = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:Swim',
    'DTSTART:20260101T090000', 'DTEND:20260101T100000', 'RRULE:FREQ=DAILY', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  function network() {
    const asked = [];
    const impl = (url) => {
      const u = String(url);
      if (/shared\.liquid$/.test(u)) return template();
      asked.push(u);
      if (/\.ics$/.test(u)) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(FEED) });
      return Promise.reject(new TypeError('Failed to fetch'));
    };
    return { asked, impl };
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function settle() { await wait(260); await h.flush(); await wait(5); await h.flush(); }
  const inZone = (sec) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(sec * 1000)).replace(',', '');
  async function drawn(search) {
    const net = network();
    const ed = loadEditor(net.impl, search);
    fireInput(ed.document.getElementById('pTz'), ZONE);
    fireInput(ed.document.getElementById('pNow'), '12:00');
    ed.document.getElementById('importIn').value = 'https://cal.example.com/swim.ics';
    click(ed.document.getElementById('loadImport'));
    await h.flush();
    const real = ed.window.run;
    ed.runs = [];
    ed.window.run = (input) => { ed.runs.push(input.trmnl.system.timestamp_utc); return real(input); };
    click(ed.document.getElementById('runPreview'));
    await h.flush();
    assert(!ed.document.getElementById('stage').hidden, 'sanity: the board should have drawn');
    ed.net = net;
    return ed;
  }

  test('?date= draws that day, and Next day is the same time the next day across a clock change, with no refetch', async () => {
    const ed = await drawn('?date=2026-03-28');
    const { document } = ed;
    assertEqual(inZone(ed.runs[0]), '2026-03-28 12:00');
    const asked = ed.net.asked.length;
    click(document.getElementById('pDayNext'));
    await settle();
    assertEqual(ed.runs.length, 2, 'Next day did not redraw once');
    assertEqual(inZone(ed.runs[1]), '2026-03-29 12:00');
    assertEqual(ed.runs[1] - ed.runs[0], 23 * 3600, 'not one calendar day in the board\'s zone');
    click(document.getElementById('pDayPrev'));
    click(document.getElementById('pDayPrev'));
    await settle();
    assertEqual(inZone(ed.runs[ed.runs.length - 1]), '2026-03-27 12:00');
    assertEqual(ed.net.asked.length, asked, 'changing the day fetched a feed again');
    assert(/Fri (27 Mar|Mar 27)/.test(document.getElementById('pDay').textContent), document.getElementById('pDay').textContent);
  });

  test('the day reads Today, Tomorrow and Yesterday, and Back to now returns to today', async () => {
    const ed = await drawn('');
    const { document } = ed;
    const day = () => document.getElementById('pDay').textContent;
    assertEqual(day(), 'Today');
    click(document.getElementById('pDayNext'));
    assertEqual(day(), 'Tomorrow');
    click(document.getElementById('pDayPrev'));
    click(document.getElementById('pDayPrev'));
    assertEqual(day(), 'Yesterday');
    await settle();
    const last = ed.runs[ed.runs.length - 1];
    assert(Math.abs(last - (ed.runs[0] - 86400)) <= 3600, 'Yesterday did not draw a day earlier');
    click(document.getElementById('pNowReset'));
    await settle();
    assertEqual(day(), 'Today');
    assert(Math.abs(ed.runs[ed.runs.length - 1] - Date.now() / 1000) < 120, 'Back to now did not draw the current moment');
    // named for screen readers, and pressable from the keyboard as buttons
    assertEqual(document.getElementById('pDayPrev').tagName, 'BUTTON');
    assertEqual(document.getElementById('pDayNext').getAttribute('aria-label'), 'Next day');
    assertEqual(document.getElementById('pDay').getAttribute('aria-live'), 'polite');
  });
};
