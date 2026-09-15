'use strict';

// THE FOLD UNDER THE MAP SAYS WHAT IS IN IT.
//
// Feeds that failed get a red card each, because a failure is the thing
// somebody has to act on; everything else folds away behind one line so six
// working feeds do not push the board off the top of the panel. That line
// read "The 6 feeds this was drawn from" whatever the state of them: before
// any draw at all, with nothing read and nothing drawn, a freshly pasted
// list of links was described as the feeds a board had been drawn from.
//
// It matters more than a wrong word, because the relay dialog's most
// private way out -- "Paste the .ics myself" -- sends the reader to the
// boxes inside that fold. The fold is shut, the boxes inside it are hidden
// until asked for, and the instruction was to press a button they could not
// see, under a heading saying the feeds had already been read.

const fs = require('fs');
const path = require('path');

module.exports = function (test, h) {
  const { loadEditor, click, assert } = h;
  const REPO_ROOT = path.join(__dirname, '../../..');

  function withTwoLinks() {
    const { document } = loadEditor();
    document.getElementById('importIn').value = 'https://a.example/x.ics\nhttps://b.example/y.ics';
    click(document.getElementById('loadImport'));
    return document;
  }
  const summary = (document) => document.querySelector('#sources summary').textContent;

  test('the feeds fold does not claim a draw that has not happened', () => {
    const document = withTwoLinks();
    const line = summary(document);
    assert(!/drawn from/.test(line),
      'nothing has been drawn, and the panel says these are the feeds it was drawn from: ' + line);
    assert(/none read yet/.test(line), 'the line does not say the feeds still need reading: ' + line);
  });

  // And once a board HAS been drawn from them, it says that instead: the
  // line was painted a moment before the draw recorded itself, so a board
  // freshly on screen was described as feeds the page had merely read.
  test('after a draw the fold says the board was drawn from them', async () => {
    const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
    const { document } = loadEditor((url) => {
      const u = String(url);
      if (/shared\.liquid$/.test(u)) {
        return Promise.resolve({ ok: true, status: 200,
          text: () => Promise.resolve(fs.readFileSync(path.join(REPO_ROOT, 'plugin/src/shared.liquid'), 'utf-8')) });
      }
      if (/crew\.ics$/.test(u)) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ICS) });
      return Promise.reject(new Error('Failed to fetch'));
    });
    document.getElementById('importIn').value = 'https://a.example/crew.ics';
    click(document.getElementById('loadImport'));
    click(document.getElementById('runPreview'));
    await h.flush();
    assert(/drawn from/.test(summary(document)),
      'a board has just been drawn from this feed and the fold does not say so: ' + summary(document));
  });

  test('the fold counts the feeds that have been read', () => {
    const document = withTwoLinks();
    const ta = document.querySelector('#sources textarea');
    ta.value = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
    ta.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
    const line = summary(document);
    assert(/1 read/.test(line) && /1 not read yet/.test(line),
      'with one of two feeds read the fold should say so: ' + line);
  });

  // AN UPLOADED FILE IS NOT THE EXAMPLE'S FEED ANY MORE.
  //
  // The feeds an example ships with are marked as its own, which is what
  // keeps their boxes shut: nobody asked to read seven generated calendars.
  // Uploading a real .ics over one stored the text and left the mark, so the
  // next time the panel was drawn -- adding a line is enough -- the card
  // said "Example feed." again and hid the file that had just been loaded.
  test('a file uploaded over an example feed replaces it', async () => {
    const { window, document } = loadEditor();
    click(document.querySelector('#presets button[data-preset="family4"]'));
    const card = document.querySelector('#sources .card');
    const file = card.querySelector('input[type=file]');
    Object.defineProperty(file, 'files', {
      value: [new window.File(['BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'], 'mine.ics')],
    });
    file.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));   // FileReader is asynchronous
    assert(/mine\.ics/.test(card.querySelector('.status').textContent), 'sanity: the file should load');

    // anything that redraws the panel
    h.addFeed(document, 'https://calendar.example.com/another.ics', 'Robin');
    const after = document.querySelector('#sources .card');
    assert(!/Example feed/.test(after.querySelector('.status').textContent),
      'the uploaded file was relabelled as the example\'s own: ' + after.querySelector('.status').textContent);
    assert(!after.querySelector('textarea').hidden,
      'the box holding the uploaded calendar was hidden again');
  });

  test('"Paste the .ics myself" opens the boxes it sends the reader to', () => {
    const document = withTwoLinks();
    click(document.getElementById('makePrompt'));
    assert(!document.getElementById('relayOffer').hidden, 'sanity: the offer should be up');

    click(document.getElementById('relayPaste'));
    const details = document.querySelector('#sources details');
    assert(details && details.open,
      'the reader was sent to a box inside a fold that is still shut');
    const boxes = [...document.querySelectorAll('#sources textarea')];
    assert(boxes.length && boxes.every((b) => !b.hidden),
      'the boxes for the unread feeds are still hidden');
  });
};
