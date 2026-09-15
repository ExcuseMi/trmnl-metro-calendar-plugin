'use strict';

// WHAT THE PROMPT SAYS ABOUT ITSELF HAS TO BE TRUE OF THE PROMPT.
//
// The status line under Generate is the tool's own verdict on the round trip
// about to be spent: how many calendars are in the prompt and how many of
// them carry events. It is read instead of the prompt, so when it counts
// something else the reader is told a wasted copy is a good one.

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, assert } = h;

  const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:Choir practice',
    'DTSTART:20260101T190000', 'DTEND:20260101T200000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');

  function withOneCalendar() {
    const { document } = loadEditor();
    // jsdom has no clipboard and no execCommand, so a copy would report that
    // it could not copy. The page's fallback is what is under test elsewhere;
    // here it just has to succeed.
    document.execCommand = () => true;
    document.getElementById('importIn').value = 'https://a.example/crew.ics';
    click(document.getElementById('loadImport'));
    return document;
  }
  function pasteFeed(document, text) {
    const ta = document.querySelector('#sources textarea');
    fireInput(ta, text);
    return ta;
  }

  test('the prompt status counts the calendars in the editor, not every feed ever read', () => {
    const { window, document } = loadEditor();
    window.confirm = () => true;
    // An example arrives with seven feeds of its own, all of them read.
    click(document.querySelector('#presets button[data-preset="family4"]'));
    // Then the user pastes their own single link, which replaces the lot.
    document.getElementById('importIn').value = 'https://mine.example/a.ics';
    click(document.getElementById('loadImport'));

    click(document.getElementById('makePrompt'));
    const st = document.getElementById('promptStatus').textContent;
    assert(!/\b7\b/.test(st),
      'the status counted the example feeds, which are not in this configuration: ' + st);
    assert(/no events/.test(st),
      'the one configured feed has not been read, and the status says otherwise: ' + st);
    assert(document.getElementById('promptStatus').className.indexOf('err') >= 0,
      'a prompt that will come back as a refusal is reported as fine');
  });

  // COPY COPIES WHAT IS TRUE NOW, NOT WHAT WAS TRUE AT GENERATE.
  //
  // Generate is pressed first, reads "none of your feeds has been read", and
  // the whole point of the two ways out offered next to it -- paste the .ics
  // under the map, fetch it through the relay -- is that they happen AFTER
  // that press. Copy then took whatever text Generate had left in the box,
  // so the prompt handed to the assistant still said "NOT READ. The browser
  // could not fetch it" about a calendar whose events were sitting in the
  // page, and the assistant duly asked for a file the user had already
  // supplied.
  test('Copy prompt copies the prompt as it is now, not the one Generate left behind', () => {
    const document = withOneCalendar();
    click(document.getElementById('makePrompt'));
    assert(/NOT READ/.test(document.getElementById('promptOut').value),
      'sanity: with nothing read the prompt should say so');

    pasteFeed(document, ICS);
    click(document.getElementById('copyPrompt'));
    const p = document.getElementById('promptOut').value;
    assert(!/NOT READ/.test(p), 'the copied prompt still calls the pasted feed unread');
    assert(/Choir practice/.test(p), 'the events pasted in never reached the copied prompt');
  });

  // A BUTTON DOES WHAT IT SAYS, WHICHEVER DOOR IT WAS REACHED THROUGH.
  //
  // The unread-feeds dialog offers three ways forward, the last of them
  // "Copy the prompt anyway". It was written for the dialog raised by Copy,
  // where the copy it had interrupted was remembered and run afterwards.
  // Generate raises the same dialog and remembered nothing, so from that
  // door the button closed the dialog and copied nothing at all: the reader
  // pressed the button that says copy, went to their assistant, and pasted
  // whatever happened to be on the clipboard before.
  test('"Copy the prompt anyway" copies, even when the offer came from Generate', () => {
    // One feed read and one not: with nothing read at all Copy is off and
    // this way out is hidden, which 21-copy-prompt-disabled covers.
    const document = withOneCalendar();
    document.getElementById('importIn').value = 'https://a.example/crew.ics\nhttps://b.example/ship.ics';
    click(document.getElementById('loadImport'));
    pasteFeed(document, ICS);
    click(document.getElementById('makePrompt'));
    assert(!document.getElementById('relayOffer').hidden,
      'sanity: an unread feed should raise the offer');
    assert(!document.getElementById('relaySkip').hidden,
      'sanity: with a feed read the copy-anyway route should be offered');

    click(document.getElementById('relaySkip'));
    assert(document.getElementById('relayOffer').hidden, 'the offer stayed up');
    assert(/Copied/.test(document.getElementById('promptStatus').textContent),
      'the button labelled "Copy the prompt anyway" copied nothing: '
        + document.getElementById('promptStatus').textContent);
  });

  // THE DIALOG NAMES THE LINKS IT WOULD SEND, SO THE LIST HAS TO BE NOW'S.
  //
  // It is the one dialog on this page that offers to hand calendar links to
  // a server, and the consent it asks for is consent to send THOSE links. It
  // was painted once and never again, so pasting a feed's .ics while it was
  // open left the feed listed as unread, under a heading counting it among
  // the calendars that could not be read -- and pressing "fetch them through
  // the relay" would have sent a link for a calendar already in hand.
  function withTwoCalendars() {
    const document = withOneCalendar();
    document.getElementById('importIn').value = 'https://a.example/crew.ics\nhttps://b.example/ship.ics';
    click(document.getElementById('loadImport'));
    return document;
  }

  test('the unread-feeds offer stops naming a calendar once it has been read', () => {
    const document = withTwoCalendars();
    click(document.getElementById('makePrompt'));
    const list = document.getElementById('relayList');
    assert(/crew\.ics/.test(list.textContent) && /ship\.ics/.test(list.textContent),
      'sanity: both unread feeds should be listed');

    // paste the .ics for the first, with the dialog still open
    fireInput(document.querySelectorAll('#sources textarea')[0], ICS);
    assert(!/crew\.ics/.test(list.textContent),
      'the offer still lists a feed whose text is now in the page: ' + list.textContent);
    assert(/ship\.ics/.test(list.textContent), 'the feed that is still unread went missing from the offer');
    assert(/1 calendar/.test(document.getElementById('relayWhy').textContent),
      'the heading still counts the feed that was read: ' + document.getElementById('relayWhy').textContent);

    fireInput(document.querySelectorAll('#sources textarea')[1], ICS);
    assert(document.getElementById('relayOffer').hidden,
      'every feed has been read and the dialog is still asking how to read them');
  });

  // A RELAY RUN THAT READ SOME OF THEM SAYS SO.
  //
  // The relay fetches each link on its own and any of them can fail. On a
  // clean run the status is rewritten; on a partial one it was left exactly
  // as Generate had written it, so a run that read three feeds of four still
  // reported "none of your 4 feed(s) has been read" while the prompt below
  // it carried three calendars' events.
  test('a relay run that read some feeds updates what the prompt says it carries', async () => {
    const relay = (url) => {
      const u = String(url);
      if (/metro-calendar\/ics/.test(u)) {
        const want = decodeURIComponent(u.split('?url=')[1] || '');
        return Promise.resolve({ ok: true, status: 200,
          text: () => Promise.resolve(/crew\.ics$/.test(want) ? ICS : '<html>not a calendar</html>') });
      }
      return Promise.reject(new Error('network disabled in tests'));
    };
    const { document } = loadEditor(relay);
    document.getElementById('importIn').value = 'https://a.example/crew.ics\nhttps://b.example/ship.ics';
    click(document.getElementById('loadImport'));
    click(document.getElementById('makePrompt'));
    click(document.getElementById('relayUse'));
    await h.flush();

    const st = document.getElementById('promptStatus').textContent;
    assert(!/none of your/.test(st), 'a feed was read through the relay and the status denies it: ' + st);
    assert(/1 of 2/.test(st), 'the status does not count what the relay read: ' + st);
    assert(/ship\.ics/.test(document.getElementById('relayList').textContent),
      'the feed that failed should still be offered a way through');
    assert(!/crew\.ics/.test(document.getElementById('relayList').textContent),
      'the feed the relay read is still listed as unread');
  });
};
