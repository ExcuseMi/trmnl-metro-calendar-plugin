'use strict';

// GOOGLE CALENDAR, AS PEOPLE ACTUALLY COPY FROM IT.
//
// "Integrate calendar" offers a browser link and an embed snippet above the
// secret address that works, and the secret one is hidden behind dots. And a
// feed of birthdays and monthly entries is not "nothing still to come".

const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '../../..');

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, assert } = h;
  const template = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve(fs.readFileSync(path.join(REPO, 'plugin/src/shared.liquid'), 'utf-8')) });
  function direct(body) {
    return function (url) {
      const u = String(url);
      if (/shared\.liquid$/.test(u)) return template();
      if (/\.ics$/.test(u)) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
      return Promise.reject(new Error('Failed to fetch'));
    };
  }
  function toFirstLink(document) {
    click(document.getElementById('wzStart'));
    fireInput(document.getElementById('wzName0'), 'Alex');
    click(document.getElementById('wzNext'));
    click(document.getElementById('wzShapeEach'));
  }
  const said = (document) => document.getElementById('wzStatus').textContent;

  test('google\'s browser link is refused and points at the secret address', () => {
    const { document } = loadEditor();
    toFirstLink(document);
    fireInput(document.getElementById('wzUrl'), 'https://calendar.google.com/calendar/embed?src=someone%40example.com&ctz=Europe%2FBrussels');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    assert(/Secret address in iCal format/.test(said(document)) && /copy icon/.test(said(document)),
      'the embed link is not explained: ' + said(document));
  });

  test('a yearly entry still to come is read out as coming, not as old', async () => {
    const year = new Date().getFullYear();
    const feed = ['BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:Birthday Quinn', 'DTSTART;VALUE=DATE:' + (year - 3) + '1231', 'RRULE:FREQ=YEARLY', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:2@x', 'SUMMARY:Dentist', 'DTSTART:' + (year - 1) + '0618T091500', 'END:VEVENT',
      'END:VCALENDAR', ''].join('\r\n');
    const { document } = loadEditor(direct(feed));
    toFirstLink(document);
    fireInput(document.getElementById('wzUrl'), 'https://cal.example.com/alex.ics');
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
    const proof = document.querySelector('#wzBody .wz-proof');
    assert(proof, 'nothing was read out');
    assert(!/Nothing in it is still to come/.test(proof.textContent), 'a yearly birthday did not count as coming: ' + proof.textContent);
    assert(/Birthday Quinn/.test(proof.textContent), 'the birthday is not read out: ' + proof.textContent);
  });
};
