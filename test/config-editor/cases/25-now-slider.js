'use strict';

// AN EXAMPLE DRAWS WHEN IT IS PICKED, AND NOW IS A SLIDER THAT REDRAWS.
//
// Picking an example used to load it and then wait for "Render the example"
// or "Draw the map", so the first click showed nothing. And the hour the
// board is drawn at was a time box folded away under the map that changed
// nothing until the map was drawn again. These hold the one-click example,
// and a slider that redraws the board on its own: once per pause, never two
// draws at once, never a request dropped, and without asking a feed that
// already refused for the same text again.

const fs = require('fs');
const path = require('path');

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, assert, assertEqual } = h;
  const REPO_ROOT = path.join(__dirname, '../../..');
  const ZONE = 'Pacific/Kiritimati';

  const template = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve(fs.readFileSync(path.join(REPO_ROOT, 'plugin/src/shared.liquid'), 'utf-8')) });
  // The template reads; every calendar link refuses, and is counted.
  function counting() {
    const asked = [];
    const impl = (url) => {
      const u = String(url);
      if (/shared\.liquid$/.test(u)) return template();
      asked.push(u);
      return Promise.reject(new Error('Failed to fetch'));
    };
    return { asked, impl };
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Past the slider's pause, then to the end of whatever that started.
  async function settle() { await wait(260); await h.flush(); await wait(5); await h.flush(); }

  function hmIn(zone, seconds) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(new Date(seconds * 1000));
  }
  // Every run() the preview makes, by the time it was asked to draw.
  function watchRuns(window) {
    const real = window.run;
    const runs = [];
    window.run = (input) => { runs.push(input); return real(input); };
    return runs;
  }
  function assertNotStale(document, when) {
    assert(document.getElementById('stage').className.indexOf('stale') === -1, 'the board is greyed out ' + when);
    assert(!/drawn before your last change/.test(document.getElementById('stageNote').textContent),
      'the board says it is out of date ' + when);
  }
  async function drawnExample(fetchImpl) {
    const ed = loadEditor(fetchImpl || counting().impl);
    fireInput(ed.document.getElementById('pTz'), ZONE);
    click(ed.document.querySelector('#presets button[data-preset="family4"]'));
    await h.flush();
    assert(!ed.document.getElementById('stage').hidden, 'sanity: the example should have drawn');
    return ed;
  }

  test('picking an example draws it, with no second button to press', async () => {
    const { document } = loadEditor(counting().impl);
    assert(!document.getElementById('renderExample'), 'the two-click Render the example button is back');
    click(document.querySelector('#presets button[data-preset="shifts"]'));
    await h.flush();
    assert(!document.getElementById('stage').hidden, 'picking an example drew nothing');
    assert(/event/.test(document.getElementById('previewStatus').textContent),
      'the example did not draw: ' + document.getElementById('previewStatus').textContent);
  });

  test('Now starts at the current time, and the slider is labelled and says the time', () => {
    const { document } = loadEditor();
    const range = document.getElementById('pNowRange');
    const box = document.getElementById('pNow');
    const d = new Date();
    const mins = d.getHours() * 60 + d.getMinutes();
    const shown = +box.value.slice(0, 2) * 60 + +box.value.slice(3, 5);
    assert(Math.abs(shown - mins) <= 1 || Math.abs(shown - mins) >= 1438, 'Now does not start at the current time: ' + box.value);
    assert.strictEqual(range.type, 'range');
    assert(Math.abs(+range.value - shown) < 5, 'the slider is not at the time in the box');
    assertEqual(range.getAttribute('aria-valuetext'), box.value);
    const label = document.querySelector('label[for="pNowRange"]');
    assert(label && /^Now\b/.test(label.textContent.trim()), 'the slider has no label a screen reader would read');
    assert(!document.getElementById('previewSettings').contains(range), 'Now is still folded away under the map');
  });

  test('moving the slider before anything is drawn draws nothing', async () => {
    const { window, document } = loadEditor(counting().impl);
    const runs = watchRuns(window);
    fireInput(document.getElementById('pNowRange'), '600');
    await settle();
    assertEqual(runs.length, 0);
    assertEqual(document.getElementById('pNow').value, '10:00');
  });

  test('a slider drag redraws once, at the last time, on the board\'s clock, without a stale warning', async () => {
    const { window, document } = await drawnExample();
    const runs = watchRuns(window);
    const range = document.getElementById('pNowRange');
    ['1170', '1175', '1200'].forEach((v) => fireInput(range, v));
    assertEqual(document.getElementById('pNow').value, '20:00');
    assertEqual(range.getAttribute('aria-valuetext'), '20:00');
    assertNotStale(document, 'while the redraw it asked for is on its way');
    await settle();
    assertEqual(runs.length, 1);
    assertEqual(runs[0].trmnl.user.time_zone_iana, ZONE);
    assertEqual(hmIn(ZONE, runs[0].trmnl.system.timestamp_utc), '20:00');
    assertNotStale(document, 'after the slider redrew it');
  });

  test('a draw asked for while one runs waits for it and runs once, with the latest time', async () => {
    const { window, document } = await drawnExample();
    const real = window.run;
    const runs = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    window.run = (input) => { runs.push(input); return gate.then(() => real(input)); };
    const range = document.getElementById('pNowRange');
    fireInput(range, '600');
    await settle();
    assertEqual(runs.length, 1, 'sanity: the first redraw started');
    fireInput(range, '1260');
    click(document.getElementById('runPreview'));
    fireInput(range, '1275');
    await settle();
    assertEqual(runs.length, 1, 'a second draw started while the first was still running');
    release();
    await settle();
    assertEqual(runs.length, 2, 'the draw asked for during the run was dropped, or ran more than once');
    assertEqual(hmIn(ZONE, runs[1].trmnl.system.timestamp_utc), '21:15');
    assertNotStale(document, 'after the queued draw');
  });

  test('a feed that refused is not asked again because the slider moved, but Draw the map asks', async () => {
    const feeds = counting();
    const { document } = loadEditor(feeds.impl);
    document.getElementById('importIn').value = 'https://a.example/crew.ics';
    click(document.getElementById('loadImport'));
    click(document.getElementById('runPreview'));
    await h.flush();
    assertEqual(feeds.asked.length, 1);
    fireInput(document.getElementById('pNowRange'), '900');
    await settle();
    assertEqual(feeds.asked.length, 1, 'a slider move fetched the refused feed again');
    assert(/could not be read/.test(document.getElementById('previewStatus').textContent),
      'the redraw forgot the feed had failed: ' + document.getElementById('previewStatus').textContent);
    assert(document.querySelector('#sources .card.failed'), 'the failed feed lost its reason under the map');
    click(document.getElementById('runPreview'));
    await h.flush();
    assertEqual(feeds.asked.length, 2, 'Draw the map should try the feed again');
  });

  test('Back to now draws the real moment again', async () => {
    const { window, document } = await drawnExample();
    fireInput(document.getElementById('pNowRange'), '300');
    await settle();
    const runs = watchRuns(window);
    click(document.getElementById('pNowReset'));
    await settle();
    assertEqual(runs.length, 1);
    const at = runs[0].trmnl.system.timestamp_utc;
    assert(Math.abs(at - Date.now() / 1000) < 120, 'Back to now did not draw the current moment');
    assertEqual(document.getElementById('pNow').value, hmIn(ZONE, Math.floor(Date.now() / 1000)));
  });

  test('a time to the minute stays to the minute, and the slider snaps beside it', () => {
    const { document } = loadEditor();
    fireInput(document.getElementById('pNow'), '19:32');
    const range = document.getElementById('pNowRange');
    assert(Math.abs(+range.value - (19 * 60 + 32)) < 5, 'the slider did not follow the typed time');
    assertEqual(range.getAttribute('aria-valuetext'), '19:32');
    assertEqual(document.getElementById('pNow').value, '19:32');
  });
};
