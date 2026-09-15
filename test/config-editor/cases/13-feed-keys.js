'use strict';

const fs = require('fs');
const path = require('path');

// A FEED IS FILED UNDER THE LINK THE USER WROTE.
//
// iCloud hands out webcal:// links, and they are pasted in exactly as
// given. Nothing can fetch that scheme, so the plugin rewrites it to
// https:// before fetching -- and the preview then stored what came back,
// and any failure, under the REWRITTEN address. Everything else on this
// page looks a feed up by the address in the calendar card, so both halves
// went missing at once:
//
//   * a webcal feed that WAS read still counted as unread. The prompt said
//     "NOT READ. The browser could not fetch it", the relay offered to send
//     the link to a server to fetch a calendar this page had already read,
//     and the status line claimed events it was not carrying.
//   * a webcal feed that FAILED said so nowhere. The panel reported "1 feed
//     of 1 could not be read: each one says why below", and below it the
//     feed sat folded away under "the feed this was drawn from", with no
//     red card and no reason.

module.exports = function (test, h) {
  const { loadEditor, click, assert } = h;
  const REPO_ROOT = path.join(__dirname, '../../..');

  const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Nubbin',
    'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:Choir practice',
    'DTSTART:20260101T190000', 'DTEND:20260101T200000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');

  const template = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve(fs.readFileSync(path.join(REPO_ROOT, 'plugin/src/shared.liquid'), 'utf-8')) });

  // The feed answers, but only at the https:// address the plugin rewrites
  // the webcal:// one into, which is what a real calendar host does.
  function readable(url) {
    const u = String(url);
    if (/shared\.liquid$/.test(u)) return template();
    if (u === 'https://b.example/y.ics') return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ICS) });
    return Promise.reject(new Error('Failed to fetch'));
  }
  function unreadable(url) {
    const u = String(url);
    if (/shared\.liquid$/.test(u)) return template();
    return Promise.reject(new Error('Failed to fetch'));
  }

  function loadWebcal(document) {
    document.getElementById('importIn').value = 'webcal://b.example/y.ics';
    click(document.getElementById('loadImport'));
  }

  test('a webcal feed the map drew from counts as read, not as unread', async () => {
    const { document } = loadEditor(readable);
    loadWebcal(document);
    click(document.getElementById('runPreview'));
    await h.flush();
    assert(/event/.test(document.getElementById('previewStatus').textContent),
      'sanity: the draw should have read the feed: ' + document.getElementById('previewStatus').textContent);

    click(document.getElementById('makePrompt'));
    const p = document.getElementById('promptOut').value;
    assert(!/NOT READ/.test(p), 'the prompt calls a feed unread that the map was just drawn from');
    assert(/Choir practice/.test(p), 'the events the draw read never reached the prompt');
    assert(document.getElementById('relayOffer').hidden,
      'the relay offered to fetch a calendar this page has already read');
  });

  test('a webcal feed that could not be read says why, on its own card', async () => {
    const { document } = loadEditor(unreadable);
    loadWebcal(document);
    click(document.getElementById('runPreview'));
    await h.flush();
    const status = document.getElementById('previewStatus').textContent;
    assert(/could not be read/.test(status), 'sanity: the feed should have failed: ' + status);
    const failed = document.querySelector('#sources .card.failed');
    assert(failed, 'the panel says each failed feed says why below, and none of them does');
    assert(/could not read the feed/.test(failed.textContent),
      'the failed feed card does not say what went wrong: ' + failed.textContent);
  });
};
