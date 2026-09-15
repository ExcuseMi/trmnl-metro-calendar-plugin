'use strict';

const fs = require('fs');
const path = require('path');

// A DRAWN MAP IS A PICTURE OF THE MOMENT IT WAS DRAWN.
//
// The page greys the board out and says "drawn before your last change" the
// instant the configuration or a preview setting differs from what was
// drawn. The fingerprint it compares covers both of those and not the one
// thing that decides what is ON the board: the calendar text this page has
// read. So the sequence this tool is built around -- draw, watch a feed fail,
// paste its .ics under the map -- ended with a board that was missing that
// whole feed, in full black, claiming to be the answer.

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, assert } = h;
  const REPO_ROOT = path.join(__dirname, '../../..');

  const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:Choir practice',
    'DTSTART:20260101T190000', 'DTEND:20260101T200000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');

  const template = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve(fs.readFileSync(path.join(REPO_ROOT, 'plugin/src/shared.liquid'), 'utf-8')) });

  // The template is readable, the calendar is not: the ordinary case, since
  // a calendar feed sends no CORS header.
  function noFeeds(url) {
    return /shared\.liquid$/.test(String(url)) ? template() : Promise.reject(new Error('Failed to fetch'));
  }
  function withRelay(url) {
    const u = String(url);
    if (/shared\.liquid$/.test(u)) return template();
    if (/metro-calendar\/ics/.test(u)) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ICS) });
    return Promise.reject(new Error('Failed to fetch'));
  }

  async function drawnEditor(fetchImpl) {
    const { document } = loadEditor(fetchImpl);
    document.getElementById('importIn').value = 'https://a.example/crew.ics';
    click(document.getElementById('loadImport'));
    click(document.getElementById('runPreview'));
    await h.flush();
    assert(document.getElementById('stage').hidden === false, 'sanity: a board should have been drawn');
    assert(document.getElementById('stage').className.indexOf('stale') === -1,
      'sanity: a board is not stale the moment it is drawn');
    return document;
  }

  function assertStale(document, what) {
    assert(document.getElementById('stage').className.indexOf('stale') >= 0,
      'the board still looks like the answer after ' + what);
    const note = document.getElementById('stageNote');
    assert(!note.hidden && /drawn before your last change/.test(note.textContent),
      'nothing on the board says it is out of date after ' + what + ': ' + note.textContent);
  }

  test('pasting a feed under the map makes the drawn board say it is out of date', async () => {
    const document = await drawnEditor(noFeeds);
    fireInput(document.querySelector('#sources textarea'), ICS);
    assertStale(document, 'its feed was pasted in');
  });

  // A DRAW TAKES TIME, AND THE EDITOR IS LIVE THROUGHOUT IT.
  //
  // Fetching the calendars and laying the board out is a promise chain, and
  // the form stays editable while it runs -- which is exactly when somebody
  // fixes the line name they noticed was wrong as they pressed the button.
  // The fingerprint was taken at the END of the draw, so it recorded the
  // edit as though the board had been drawn from it: the change that
  // prompted the edit never appeared, and nothing said the board was behind.
  test('a change made while the map is drawing is not counted as drawn', async () => {
    const { document } = loadEditor(noFeeds);
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Sam' }], calendars: [{ url: 'https://a.example/crew.ics', name: 'Sam' }],
    });
    click(document.getElementById('loadImport'));

    click(document.getElementById('runPreview'));
    // mid-flight, before the chain settles
    fireInput(document.querySelector('#lines .card .title-input'), 'Samuel');
    await h.flush();

    assertStale(document, 'a line was renamed while the board was drawing');
  });

  test('fetching a feed through the relay makes the drawn board say it is out of date', async () => {
    const document = await drawnEditor(withRelay);
    click(document.getElementById('makePrompt'));
    click(document.getElementById('relayUse'));
    await h.flush();
    assertStale(document, 'the relay read its feed');
  });
};
