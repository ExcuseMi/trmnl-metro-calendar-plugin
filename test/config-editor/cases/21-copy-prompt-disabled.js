'use strict';

const fs = require('fs');
const path = require('path');

// COPY PROMPT IS OFF WHILE THE PROMPT CANNOT WORK.
//
// A prompt is worth pasting into an assistant only if there are real events
// in it. With no links there is nothing to describe; with nothing read the
// reply is "I cannot read these feeds, paste the .ics text" every time,
// because neither a browser nor an assistant can fetch a calendar feed. The
// tool knows both of those before the press, so the press that ends in
// somebody else's chat window is held back until it would be worth making.
//
// Generate stays on throughout: it is the button that explains the
// situation, lists the unread feeds and offers the relay.

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
  function readableFeed(url) {
    const u = String(url);
    if (/shared\.liquid$/.test(u)) return template();
    if (/crew\.ics$/.test(u)) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ICS) });
    return Promise.reject(new Error('Failed to fetch'));
  }
  function relayFeed(url) {
    const u = String(url);
    if (/metro-calendar\/ics/.test(u)) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ICS) });
    return Promise.reject(new Error('Failed to fetch'));
  }

  const copy = (document) => document.getElementById('copyPrompt');
  const why = (document) => document.getElementById('copyPromptWhy');
  function loadLinks(document, text) {
    document.getElementById('importIn').value = text;
    click(document.getElementById('loadImport'));
  }
  function assertOff(document, what) {
    assert(copy(document).disabled, 'Copy prompt is live ' + what);
    assert(!why(document).hidden && why(document).textContent.trim().length > 20,
      'nothing says why Copy is off ' + what + ': ' + JSON.stringify(why(document).textContent));
    assert((copy(document).getAttribute('title') || '').length > 20,
      'the disabled button carries no tooltip ' + what);
  }
  function assertOn(document, what) {
    assert(!copy(document).disabled, 'Copy prompt is still off ' + what);
    assert(why(document).hidden, 'the reason Copy was off is still on screen ' + what);
  }

  test('with no calendars at all, Copy is off and says what to add', () => {
    const { document } = loadEditor();
    assertOff(document, 'with no calendar links in the editor');
    assert(/link/i.test(why(document).textContent), 'it does not say a link is what is missing');
    assert(!document.getElementById('makePrompt').disabled,
      'Generate must stay live: it is what explains the situation and offers the relay');
  });

  test('with links but nothing read, Copy is off and names the three ways to read one', () => {
    const { document } = loadEditor();
    loadLinks(document, 'https://a.example/crew.ics\nhttps://b.example/ship.ics');
    assertOff(document, 'with two feeds and neither of them read');
    const text = why(document).textContent;
    assert(/Draw the map/.test(text), 'it does not name drawing the map: ' + text);
    assert(/paste/i.test(text), 'it does not name pasting the .ics: ' + text);
    assert(/relay/i.test(text), 'it does not name the relay: ' + text);
  });

  test('pasting one calendar turns Copy on', () => {
    const { document } = loadEditor();
    loadLinks(document, 'https://a.example/crew.ics\nhttps://b.example/ship.ics');
    fireInput(document.querySelector('#sources textarea'), ICS);
    assertOn(document, 'after one of two feeds was pasted in');
  });

  test('a draw that reads a calendar turns Copy on', async () => {
    const { document } = loadEditor(readableFeed);
    loadLinks(document, 'https://a.example/crew.ics');
    assertOff(document, 'before the map has been drawn');
    click(document.getElementById('runPreview'));
    await h.flush();
    assertOn(document, 'after a draw that read the feed');
  });

  test('a draw where every feed failed leaves Copy off', async () => {
    const { document } = loadEditor((url) => (/shared\.liquid$/.test(String(url))
      ? template() : Promise.reject(new Error('Failed to fetch'))));
    loadLinks(document, 'https://a.example/crew.ics');
    click(document.getElementById('runPreview'));
    await h.flush();
    assertOff(document, 'after a draw in which the feed could not be read');
  });

  test('a relay fetch turns Copy on', async () => {
    const { document } = loadEditor(relayFeed);
    loadLinks(document, 'https://a.example/crew.ics');
    click(document.getElementById('makePrompt'));
    click(document.getElementById('relayUse'));
    await h.flush();
    assertOn(document, 'after the relay read the feed');
  });

  test('loading an example turns Copy on, and starting for real turns it off', () => {
    const { window, document } = loadEditor();
    window.confirm = () => true;
    click(document.querySelector('#presets button[data-preset="family4"]'));
    assertOn(document, 'with an example loaded, whose feeds come with it');

    click(document.getElementById('goReal'));
    click(document.getElementById('chooseManual'));
    assertOff(document, 'after the example was cleared to start for real');
  });

  test('Copy follows the calendars: removing the last one turns it off again', () => {
    const { document } = loadEditor();
    loadLinks(document, 'https://a.example/crew.ics');
    fireInput(document.querySelector('#sources textarea'), ICS);
    assertOn(document, 'with one feed read');

    click(document.querySelector('#calendars .card button[title="Remove this calendar"]'));
    assertOff(document, 'once the calendar holding that feed was removed');
  });

  test('undo puts Copy back in step with what it restores', () => {
    const { document } = loadEditor();
    loadLinks(document, 'https://a.example/crew.ics');
    fireInput(document.querySelector('#sources textarea'), ICS);
    assertOn(document, 'with one feed read');
    // a second load replaces the configuration, and its feed is unread
    loadLinks(document, 'https://c.example/other.ics');
    assertOff(document, 'after a load whose feed has not been read');
    click(document.getElementById('undoBtn'));
    assertOn(document, 'after undoing back to the configuration whose feed was read');
  });

  // The dialog's third way out is the same copy under another name, so it
  // cannot be the door somebody walks through to copy a prompt that Copy
  // itself refuses to hand over.
  test('"Copy the prompt anyway" is hidden while Copy would be disabled', () => {
    const { document } = loadEditor();
    loadLinks(document, 'https://a.example/crew.ics\nhttps://b.example/ship.ics');
    click(document.getElementById('makePrompt'));
    assert(!document.getElementById('relayOffer').hidden, 'sanity: the offer should be up');
    assert(document.getElementById('relaySkip').hidden,
      'the dialog offers a way to copy a prompt that Copy will not copy');
    // the other two ways out are still there: this must not become a dead end
    assert(!document.getElementById('relayPaste').hidden, 'the paste route went missing');
    assert(!document.getElementById('relayUse').hidden, 'the relay route went missing');
    // and the dialog counts what it is actually offering
    const offer = () => document.getElementById('relayOffer').textContent;
    assert(!/Three ways/.test(offer()), 'the dialog promises three ways forward and shows two');
    assert(/Two ways/.test(offer()), 'the dialog does not say how many ways out it has: ' + offer());

    // read one of the two, and the way out comes back
    fireInput(document.querySelector('#sources textarea'), ICS);
    assert(!document.getElementById('relaySkip').hidden,
      'with a feed read the prompt is worth copying, and the dialog should say so');
    assert(/Three ways/.test(document.getElementById('relayOffer').textContent),
      'all three ways out are offered again and the dialog still counts two');
  });

  // AND IT HAS TO BE HIDDEN ON SCREEN, NOT ONLY IN THE DOM.
  //
  // `.choice button` sets display:flex, which outranks the browser's own
  // rule for [hidden]: setting the property changed nothing a reader could
  // see, and in a real browser the button stayed in the dialog, in a row of
  // three, offering exactly the copy that Copy had just refused. jsdom
  // resolves the two rules the other way round and reports it hidden, so
  // this is checked in the stylesheet, the same way the page-grid collision
  // is. The page has met this once before, which is why `.choice[hidden]`
  // is written out for the container.
  test('a hidden way out is hidden in the stylesheet too, not only in the DOM', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'tools/config-editor.html'), 'utf-8');
    const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
    assert(/\.choice\s+button\[hidden\][^{]*\{[^}]*display:\s*none/.test(css),
      '.choice button sets display:flex, so a button hidden with the [hidden] attribute is '
      + 'still drawn. The stylesheet needs a .choice button[hidden] rule of its own.');
  });
};
