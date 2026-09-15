'use strict';

// WHAT WENT WRONG, SAID WHERE IT WAS ASKED FOR. A relay that refused the
// page's origin read "Failed to fetch. Check you copied the whole link",
// under the Next button. And three small things from the same walk: the
// calendar service asked for again for every person, a second calendar
// moving straight on, and a board that did not redraw after a rule edit.

const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '../../..');
const KEY = 'metro-calendar-relay-ok';

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, assert, assertEqual } = h;
  const template = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve(fs.readFileSync(path.join(REPO, 'plugin/src/shared.liquid'), 'utf-8')) });
  // The calendar refuses the page; the relay answers `relay(u)`.
  function network(relay) {
    const calls = [];
    const impl = (url) => {
      const u = String(url);
      calls.push(u);
      if (/shared\.liquid$/.test(u)) return template();
      if (/metro-calendar\/ics/.test(u)) return relay(u);
      return Promise.reject(new TypeError('Failed to fetch'));
    };
    return { calls, impl };
  }
  const refused = () => Promise.reject(new TypeError('Failed to fetch'));
  const answered = (status, body) => () => Promise.resolve({ ok: false, status, text: () => Promise.resolve(body) });
  const wzBody = (document) => document.getElementById('wzBody');
  const next = (document) => document.getElementById('wzNext');
  const q = (document) => document.getElementById('wzQ').textContent;
  function toLink(document, names) {
    click(document.getElementById('wzStart'));
    names.forEach((n, i) => {
      if (i > 0) click(h.buttonByText(wzBody(document), 'Add another person'));
      fireInput(document.getElementById('wzName' + i), n);
    });
    click(next(document));
    click(document.getElementById('wzShapeEach'));
  }
  async function check(document, url) {
    fireInput(document.getElementById('wzUrl'), url);
    click(h.buttonByText(wzBody(document), 'Check this link'));
    await h.flush();
  }
  async function relayOnce(document) {
    click(document.getElementById('wzRelayYes'));
    await h.flush();
    return document.getElementById('wzReadError');
  }

  test('a relay that will not answer the page is not blamed on the link', async () => {
    const { document } = loadEditor(network(refused).impl);
    toLink(document, ['Alex']);
    await check(document, 'https://cal.example.com/alex.ics');
    const box = await relayOnce(document);
    assert(box && box.closest('.wz-consent'), 'the reason is not beside the buttons pressed');
    const t = box.textContent;
    assert(/trmnl\.bettens\.dev did not answer this page/.test(t) && /not a problem with your link/.test(t), t);
    assert(/Try again later/.test(t) && /\.ics file/.test(t), t);
    assert(!/Failed to fetch|copied the whole link|password/.test(t), 'the old advice is back: ' + t);
  });

  test('a calendar answering an error, and a link that is not a calendar, each say so', async () => {
    let ed = loadEditor(network(answered(422, 'the calendar answered 403')).impl);
    toLink(ed.document, ['Alex']);
    await check(ed.document, 'https://cal.example.com/alex.ics');
    let t = (await relayOnce(ed.document)).textContent;
    assert(/calendar refused/.test(t) && /sharing/.test(t), t);

    ed = loadEditor(network(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html>Sign in</html>') })).impl);
    toLink(ed.document, ['Alex']);
    await check(ed.document, 'https://cal.example.com/alex.ics');
    t = (await relayOnce(ed.document)).textContent;
    assert(/not a calendar/.test(t) && /sign-in page/.test(t), t);
  });

  test('remembered, a failed read is said under the link with its ways on', async () => {
    const { window, document } = loadEditor(network(answered(502, 'error code: 502')).impl);
    window.localStorage.setItem(KEY, 'yes');
    toLink(document, ['Alex', 'Sam']);
    await check(document, 'https://cal.example.com/alex.ics');
    const box = document.getElementById('wzReadError');
    assert(box && !box.closest('.wz-consent'), 'no reason shown beside the link');
    assert(/not working right now/.test(box.textContent), box.textContent);
    assert(document.getElementById('wzErrUnread') && document.getElementById('wzErrFile'), 'no way on from the failure');
    click(document.getElementById('wzErrUnread'));
    assert(/Sam/.test(q(document)), 'adding it unread did not move on: ' + q(document));
  });

  test('the full editor says why beside the relay buttons', async () => {
    const { document } = loadEditor(network(refused).impl);
    h.addFeed(document, 'https://cal.example.com/sam.ics', 'Sam');
    await h.flush();
    click(document.getElementById('feedRelayOnce'));
    await h.flush();
    const st = document.getElementById('feedRelayStatus');
    assert(st && /did not answer this page/.test(st.textContent), st ? st.textContent : 'no status beside the buttons');
  });

  // ---- the walk -----------------------------------------------------------

  test('the calendar service picked for one person is already picked for the next', () => {
    const { document } = loadEditor();
    toLink(document, ['Alex', 'Sam']);
    click(document.getElementById('wzProv-nextcloud'));
    click(document.getElementById('wzSkip'));
    assert(/Sam/.test(q(document)), q(document));
    assertEqual(document.getElementById('wzProv-nextcloud').getAttribute('aria-pressed'), 'true');
    assert(/In Nextcloud/.test(wzBody(document).textContent), 'the clicks for it are not shown');
  });

  // ---- a rule edit redraws the board ----------------------------------------

  test('editing a rule under a drawn board redraws it once, from the feeds already read', async () => {
    const asked = [];
    const { window, document } = loadEditor((url) => {
      const u = String(url);
      if (/shared\.liquid$/.test(u)) return template();
      asked.push(u);
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    click(document.querySelector('#presets button[data-preset="family4"]'));
    await h.flush();
    assert(!document.getElementById('stage').hidden, 'sanity: the example should have drawn');
    const before = asked.length;
    const real = window.run;
    const runs = [];
    window.run = (input) => { runs.push(input); return real(input); };
    click(document.getElementById('addGlobalRule'));
    const rule = [...document.querySelectorAll('#globalRules .rule')].pop();
    ['P', 'Pi', 'Piano'].forEach((v) => fireInput(rule.querySelector('.cond-value'), v));
    h.checkByLabel(rule, 'hide it from the map').checked = true;
    h.fireChange(h.checkByLabel(rule, 'hide it from the map'));
    await new Promise((r) => setTimeout(r, 480));
    await h.flush();
    assertEqual(runs.length, 1, 'the edits drew ' + runs.length + ' times');
    assert(/Piano/.test(runs[0].trmnl.plugin_settings.custom_fields_values.config_json), 'the redraw did not carry the rule');
    assertEqual(asked.length, before, 'the redraw fetched a feed again');
  });
};
