'use strict';

// ASKED ONCE, THEN REMEMBERED IF YOU SAY SO.
//
// The relay used to be asked for on every link and every reload. The answer
// can now be "yes, and do not ask again on this device": from then on a feed
// this page cannot read directly goes through the relay with no dialog, but
// never silently, and the way to take it back is beside the line that says
// so. Every place a feed is read goes through the one function, so the
// wizard, a hand-added calendar, a pasted configuration, a resumed setup, the
// preview and the prompt all honour the same answer.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../../..');
const KEY = 'metro-calendar-relay-ok';

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, jsonOut, assert, assertEqual } = h;

  function ics(name) {
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:' + name,
      'BEGIN:VEVENT', 'UID:1@x', 'SUMMARY:Practice', 'DTSTART:20991103T160000', 'DTEND:20991103T170000', 'END:VEVENT',
      'END:VCALENDAR', ''].join('\r\n');
  }
  // Every calendar refuses a web page; the relay reads any of them, and
  // every request is written down in order.
  function network() {
    const calls = [];
    const impl = (url) => {
      const u = String(url);
      calls.push(u);
      if (/shared\.liquid$/.test(u)) {
        return Promise.resolve({ ok: true, status: 200,
          text: () => Promise.resolve(fs.readFileSync(path.join(REPO, 'plugin/src/shared.liquid'), 'utf-8')) });
      }
      if (/metro-calendar\/ics/.test(u)) {
        const want = decodeURIComponent(u.split('url=')[1] || '');
        const m = /\/([a-z-]+)\.ics$/.exec(want);
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ics('Feed ' + (m ? m[1] : 'x'))) });
      }
      return Promise.reject(new Error('Failed to fetch'));
    };
    const relayed = () => calls.filter((u) => /metro-calendar\/ics/.test(u)).map((u) => decodeURIComponent(u.split('url=')[1]));
    return { calls, impl, relayed };
  }
  const q = (document) => document.getElementById('wzQ').textContent;
  const said = (document) => document.getElementById('wzStatus').textContent;
  const next = (document) => document.getElementById('wzNext');
  async function check(document, url) {
    fireInput(document.getElementById('wzUrl'), url);
    click(h.buttonByText(document.getElementById('wzBody'), 'Check this link'));
    await h.flush();
  }
  function people(document, names) {
    click(document.getElementById('wzStart'));
    names.forEach((n, i) => {
      if (i > 0) click(h.buttonByText(document.getElementById('wzBody'), 'Add another person'));
      fireInput(document.getElementById('wzName' + i), n);
    });
    click(next(document));
    click(document.getElementById('wzShapeEach'));
  }

  // ---- the wizard ------------------------------------------------------

  test('"just this time" reads the one link and remembers nothing', async () => {
    const net = network();
    const { window, document } = loadEditor(net.impl);
    people(document, ['Alex', 'Sam']);
    await check(document, 'https://cal.example.com/alex.ics');
    assert(document.getElementById('wzRelayAlways'), 'there is no way to say "do not ask again"');
    click(document.getElementById('wzRelayYes'));
    await h.flush();
    assert(document.querySelector('#wzBody .wz-proof'), 'the relay read did not show the calendar');
    assertEqual(window.localStorage.getItem(KEY), null, '"just this time" was remembered');
    click(next(document));
    await check(document, 'https://cal.example.com/sam.ics');
    assert(document.querySelector('#wzBody .wz-consent'), 'the next link was not asked about');
    assertEqual(net.relayed(), ['https://cal.example.com/alex.ics'], 'the second link was sent before anybody said yes');
  });

  test('remembered, the next link goes through the relay after the direct read fails, and says so', async () => {
    const net = network();
    const { window, document } = loadEditor(net.impl);
    people(document, ['Alex', 'Sam']);
    await check(document, 'https://cal.example.com/alex.ics');
    click(document.getElementById('wzRelayAlways'));
    await h.flush();
    assertEqual(window.localStorage.getItem(KEY), 'yes');
    click(next(document));

    await check(document, 'https://cal.example.com/sam.ics');
    assert(!document.querySelector('#wzBody .wz-consent'), 'it asked again after being told not to');
    assert(document.querySelector('#wzBody .wz-proof'), 'the calendar was not read');
    const sam = net.calls.indexOf('https://cal.example.com/sam.ics');
    const relayed = net.calls.findIndex((u) => /metro-calendar\/ics/.test(u) && /sam\.ics/.test(decodeURIComponent(u)));
    assert(sam >= 0 && relayed > sam, 'the direct read was not tried first: ' + JSON.stringify(net.calls));
    assert(/through trmnl\.bettens\.dev/.test(said(document)), 'the relay read was silent: ' + said(document));

    // and it can be taken back from right there
    const stop = document.getElementById('wzRelayStop');
    assert(stop && /Stop reading calendars through trmnl\.bettens\.dev/.test(stop.textContent), 'there is no way to stop it');
    click(stop);
    assertEqual(window.localStorage.getItem(KEY), null, 'stopping left the answer stored');
    click(next(document));
    click(document.getElementById('wzAddShared'));
    click(document.getElementById('wzForAll'));
    await check(document, 'https://cal.example.com/house.ics');
    assert(document.querySelector('#wzBody .wz-consent'), 'after stopping, the next link was not asked about');
  });

  test('the answer survives a reload', async () => {
    const net = network();
    const first = loadEditor(net.impl);
    people(first.document, ['Alex']);
    await check(first.document, 'https://cal.example.com/alex.ics');
    click(first.document.getElementById('wzRelayAlways'));
    await h.flush();
    const { window, document } = loadEditor(net.impl);
    window.localStorage.setItem(KEY, first.window.localStorage.getItem(KEY));
    people(document, ['Sam']);
    await check(document, 'https://cal.example.com/sam.ics');
    assert(!document.querySelector('#wzBody .wz-consent') && document.querySelector('#wzBody .wz-proof'),
      'a new visit asked again');
  });

  // ---- a calendar added by hand ----------------------------------------

  test('a calendar added by hand is read at once, and the relay is offered where it failed', async () => {
    const net = network();
    const { window, document } = loadEditor(net.impl);
    h.addFeed(document, 'https://cal.example.com/quinn.ics', 'Quinn');
    await h.flush();
    const offer = document.getElementById('feedRelay');
    assert(offer, 'a feed that would not answer has no relay offer under the map: ' + document.getElementById('sources').textContent);
    assert(/quinn\.ics/.test(offer.textContent) && /trmnl\.bettens\.dev/.test(offer.textContent) && /password/.test(offer.textContent),
      'the offer does not name the link, the server and what a link is');
    assertEqual(net.relayed(), [], 'the relay was used before it was chosen');

    click(document.getElementById('feedRelayAlways'));
    await h.flush();
    assertEqual(window.localStorage.getItem(KEY), 'yes');
    assertEqual(net.relayed(), ['https://cal.example.com/quinn.ics']);
    const box = document.querySelector('#sources textarea[data-feed="https://cal.example.com/quinn.ics"]');
    assert(box && /Feed quinn/.test(box.value), 'what the relay read was not kept as the feed');
    assert(/Read through trmnl\.bettens\.dev/.test(document.getElementById('sources').textContent), 'the feed does not say how it was read');
    assert(document.getElementById('relayStop'), 'there is no way to stop under the map');

    // the next one goes through without a question
    h.addFeed(document, 'https://cal.example.com/jules.ics', 'Jules');
    await h.flush();
    assert(!document.getElementById('feedRelay'), 'it asked again');
    assertEqual(net.relayed(), ['https://cal.example.com/quinn.ics', 'https://cal.example.com/jules.ics']);

    // stopping asks again for the next one
    click(document.getElementById('relayStop'));
    assertEqual(window.localStorage.getItem(KEY), null);
    h.addFeed(document, 'https://cal.example.com/remy.ics', 'Remy');
    await h.flush();
    assert(document.getElementById('feedRelay'), 'after stopping, the next feed was not asked about');
    assertEqual(net.relayed().length, 2);
  });

  // ---- a configuration pasted in ---------------------------------------

  test('a pasted configuration is read straight away, through the relay once that is remembered', async () => {
    const net = network();
    const { window, document } = loadEditor(net.impl);
    window.localStorage.setItem(KEY, 'yes');
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Alex' }],
      calendars: [{ url: 'https://cal.example.com/alex.ics', name: 'Alex', line: 'Alex' },
        'https://cal.example.com/house.ics'],
    });
    click(document.getElementById('loadImport'));
    await h.flush();
    assertEqual(net.relayed().sort(), ['https://cal.example.com/alex.ics', 'https://cal.example.com/house.ics']);
    assert(document.getElementById('relayOffer').hidden, 'a dialog was raised');
    assert(/read through trmnl\.bettens\.dev/.test(document.getElementById('previewStatus').textContent),
      'nothing said the calendars went through the relay: ' + document.getElementById('previewStatus').textContent);
    // and the prompt has their events without another press
    click(document.getElementById('makePrompt'));
    assert(/Practice/.test(document.getElementById('promptOut').value), 'the pasted calendars were not read');
  });

  test('not remembered, a pasted configuration asks under the map and sends nothing first', async () => {
    const net = network();
    const { document } = loadEditor(net.impl);
    document.getElementById('importIn').value = 'https://cal.example.com/alex.ics';
    click(document.getElementById('loadImport'));
    await h.flush();
    assert(net.calls.indexOf('https://cal.example.com/alex.ics') >= 0, 'the pasted calendar was not read at once');
    assertEqual(net.relayed(), []);
    assert(document.getElementById('feedRelay'), 'there is no offer for the calendar that would not answer');
    click(document.getElementById('feedRelayOnce'));
    await h.flush();
    assertEqual(net.relayed(), ['https://cal.example.com/alex.ics']);
  });

  test('"I have already set this up once" reads what was pasted, and the board lists it by its own name', async () => {
    const net = network();
    const { window, document } = loadEditor(net.impl);
    click(document.getElementById('wzReopen'));
    document.getElementById('wzPaste').value = JSON.stringify({
      lines: [{ name: 'Alex' }],
      calendars: [{ url: 'https://cal.example.com/alex.ics', name: 'Alex', line: 'Alex' }],
    });
    click(h.buttonByText(document.getElementById('wzBody'), 'Read it and fill in my answers'));
    await h.flush();
    assert(document.querySelector('#wzBody .wz-consent'), 'the board does not ask about the calendar that would not answer');
    click(document.getElementById('wzBoardRelayAlways'));
    await h.flush();
    assertEqual(window.localStorage.getItem(KEY), 'yes');
    assertEqual([...document.querySelectorAll('#wzBody .wz-cal .what')].map((x) => x.textContent), ['Feed alex']);
    assert(document.getElementById('wzRelayStop'), 'the board does not say calendars go through the relay');
    assert(!document.querySelector('#wzBody .wz-consent'), 'it is still asking');
  });

  test('carrying on a saved setup reads calendars it has no text for, through the relay once remembered', async () => {
    const net = network();
    const { window, document } = loadEditor(net.impl);
    window.localStorage.setItem(KEY, 'yes');
    window.localStorage.setItem('metro-calendar-setup-v1', JSON.stringify({
      at: Date.now(),
      answers: { screen: 'board', people: ['Alex'], shape: 'each', queue: [], qi: 0 },
      config: { lines: [{ name: 'Alex' }], calendars: [{ url: 'https://cal.example.com/alex.ics', name: 'Alex',
        line: 'Alex' }] },
      feeds: {},
    }));
    click(document.querySelector('.mc-top nav a[href="#station-wizard"]'));
    click(document.getElementById('wzResume'));
    await h.flush();
    assertEqual(net.relayed(), ['https://cal.example.com/alex.ics']);
    assert(/here is your board/i.test(q(document)), q(document));
    assertEqual([...document.querySelectorAll('#wzBody .wz-cal .what')].map((x) => x.textContent), ['Feed alex']);
  });

  // ---- the preview and the prompt --------------------------------------

  test('remembered, the preview reads through the relay and says so, and the prompt asks nothing', async () => {
    const net = network();
    const { window, document } = loadEditor(net.impl);
    document.getElementById('importIn').value = 'https://cal.example.com/alex.ics\nhttps://cal.example.com/sam.ics';
    click(document.getElementById('loadImport'));
    await h.flush();
    window.localStorage.setItem(KEY, 'yes');
    click(document.getElementById('runPreview'));
    await h.flush();
    assertEqual(net.relayed().sort(), ['https://cal.example.com/alex.ics', 'https://cal.example.com/sam.ics']);
    assert(/read through trmnl\.bettens\.dev/.test(document.getElementById('previewStatus').textContent),
      document.getElementById('previewStatus').textContent);
    assert(!document.querySelector('#sources .card.failed'), 'a feed the relay read is still shown as failed');
    click(document.getElementById('makePrompt'));
    assert(document.getElementById('relayOffer').hidden, 'the prompt raised the dialog after it was remembered');
  });

  test('the prompt\'s own dialog can remember the answer too', async () => {
    const net = network();
    const { window, document } = loadEditor(net.impl);
    h.addFeed(document, 'https://cal.example.com/alex.ics', 'Alex');
    await h.flush();
    click(document.getElementById('makePrompt'));
    assert(!document.getElementById('relayOffer').hidden, 'sanity: the dialog is up');
    click(document.getElementById('relayAlways'));
    await h.flush();
    assertEqual(window.localStorage.getItem(KEY), 'yes');
    assert(/Practice/.test(document.getElementById('promptOut').value), 'the prompt does not carry what the relay read');
    assertEqual(jsonOut(document).calendars.length, 1);
  });
};
