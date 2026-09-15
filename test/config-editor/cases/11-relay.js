'use strict';

// A CALENDAR LINK IS A PASSWORD IN A URL.
//
// Google calls it a "secret address", and anyone holding it can read that
// calendar until it is regenerated. The relay exists because nothing else
// works -- a calendar feed sends no CORS header, so this page cannot read
// one and no assistant can fetch one either -- but using it means handing
// somebody's calendar key to a server. So it is asked for, every time, with
// the links it would send listed, and it is never the default.

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, assert } = h;

  const SOME_ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

  function withUnreadCalendar() {
    const { document } = loadEditor();
    h.addFeed(document, 'https://cal.example.com/secret-address.ics', 'Sam');
    return document;
  }
  // Copy is off entirely while NOTHING has been read: an event-less prompt
  // comes back as a refusal every time, so the button no longer hands one
  // over. The state this dialog is really about is the mixed one -- one
  // calendar read, another still not -- which is what reaches Copy now.
  function withReadAndUnreadCalendars(fetchImpl) {
    const { document } = loadEditor(fetchImpl);
    document.getElementById('importIn').value =
      'https://cal.example.com/already-read.ics\nhttps://cal.example.com/secret-address.ics';
    click(document.getElementById('loadImport'));
    fireInput(document.querySelector('#sources textarea'), SOME_ICS);
    return document;
  }

  test('copying a prompt with unread feeds asks before it copies', () => {
    const document = withReadAndUnreadCalendars();
    assert(document.getElementById('relayOffer').hidden, 'the offer is showing before anything asked for it');
    click(document.getElementById('copyPrompt'));
    assert(!document.getElementById('relayOffer').hidden, 'copying said nothing about the unread feeds');
    // and it names exactly what it would send, which is the unread one only
    const listed = document.getElementById('relayList').textContent;
    assert(/secret-address\.ics/.test(listed), 'the offer does not list the link it would send');
    assert(!/already-read\.ics/.test(listed), 'the offer would send a calendar it has already read');
  });

  test('with every feed read it just copies, and never mentions a relay', () => {
    const { document } = loadEditor();
    document.getElementById('importIn').value = 'https://cal.example.com/already-read.ics';
    click(document.getElementById('loadImport'));
    fireInput(document.querySelector('#sources textarea'), SOME_ICS);
    click(document.getElementById('copyPrompt'));
    assert(document.getElementById('relayOffer').hidden, 'it asked about feeds it had already read');
  });

  // OFFERED, NAMED, AND NOT USED UNTIL IT IS CHOSEN. The relay is the one
  // route that sends a calendar key anywhere, so the offer says whose server
  // it goes to, and nothing leaves the page merely because the dialog opened.
  test('the relay is offered with its host named, and sends nothing until chosen', () => {
    const calls = [];
    const document = withReadAndUnreadCalendars((url) => {
      calls.push(String(url));
      return Promise.reject(new Error('no network in tests'));
    });
    click(document.getElementById('copyPrompt'));
    assert(!document.getElementById('relayUse').hidden, 'a configured relay is not being offered');
    assert(/trmnl\.bettens\.dev/.test(document.getElementById('relayNote').textContent),
      'the offer does not say whose server the links would go to');
    assert(!calls.some((u) => /metro-calendar/.test(u)),
      'the relay was called before anybody chose it');
    assert(!document.getElementById('relayPaste').hidden, 'the paste route went missing');
    assert(!document.getElementById('relaySkip').hidden, 'there is no way past the dialog');
  });

  // THE REASON, NOT THE NUMBER. The relay answers a refusal with a sentence
  // ("that does not look like a calendar link"), and the reader can act on
  // that sentence. It used to arrive as "HTTP 502": Cloudflare replaces a
  // 5xx body with its own page, so the relay now refuses with a 422, and the
  // editor reads the body rather than the status.
  test('a refusal from the relay shows the relay\'s own reason', async () => {
    const { document } = loadEditor((url) => {
      if (/metro-calendar\/ics/.test(String(url))) {
        return Promise.resolve({ ok: false, status: 422,
          text: () => Promise.resolve('that does not look like a calendar link') });
      }
      return Promise.reject(new Error('no network in tests'));
    });
    h.addFeed(document, 'https://cal.example.com/not-a-calendar', 'Sam');
    click(document.getElementById('copyPrompt'));
    click(document.getElementById('relayUse'));
    await new Promise((r) => setTimeout(r, 50));
    const st = document.getElementById('relayStatus').textContent;
    assert(/does not look like a calendar link/.test(st),
      'the reader was told a status code instead of why: ' + st);
  });

  // GENERATE IS THE FIRST PRESS, SO THAT IS WHERE IT ASKS. The offer used to
  // hang off Copy only, and Generate is the button people press first: they
  // read a prompt with no events in it, copied nothing, and never saw the
  // relay at all.
  test('generating a prompt with unread feeds offers the relay too', () => {
    const document = withUnreadCalendar();
    click(document.getElementById('makePrompt'));
    assert(!document.getElementById('relayOffer').hidden,
      'Generate made an event-less prompt without offering a way to read the feeds');
    assert(/secret-address\.ics/.test(document.getElementById('relayList').textContent),
      'the offer does not list the link it would send');
  });

  // Only a way through when there is something worth copying: with nothing
  // read at all the prompt is a wasted round trip, Copy is off, and this way
  // out is hidden rather than left as a door around it (21-copy-prompt-disabled).
  test('"copy anyway" is a way through, not a dead end', () => {
    const document = withReadAndUnreadCalendars();
    click(document.getElementById('copyPrompt'));
    assert(!document.getElementById('relaySkip').hidden,
      'with a calendar read the prompt is worth copying, so the way out must be offered');
    click(document.getElementById('relaySkip'));
    assert(document.getElementById('relayOffer').hidden, 'the offer stayed up');
    assert(document.getElementById('promptOut').value.length > 0, 'no prompt was generated to copy');
  });
};
