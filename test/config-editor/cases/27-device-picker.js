'use strict';

// A DEVICE, A VIEW ON IT, AND WHICH WAY UP.
//
// The preview's device was one list mixing panels with slots on a panel
// ("TRMNL OG", "OG quadrant", "TRMNL X portrait"), so there was no room for
// the B/W/R/Y OG and no half view on anything but the OG. These hold the
// three pickers, the screen classes each panel is drawn with, a redraw when
// one changes under a drawn board, and the old `?device=` links.

const fs = require('fs');
const path = require('path');

module.exports = function (test, h) {
  const { loadEditor, click, fireChange, assert, assertEqual } = h;
  const REPO_ROOT = path.join(__dirname, '../../..');

  const template = () => Promise.resolve({ ok: true, status: 200,
    text: () => Promise.resolve(fs.readFileSync(path.join(REPO_ROOT, 'plugin/src/shared.liquid'), 'utf-8')) });
  const offline = (url) => /shared\.liquid$/.test(String(url)) ? template() : Promise.reject(new Error('Failed to fetch'));

  function screen(document) { return document.querySelector('#stageInner .screen'); }
  function classesOf(document) { return screen(document).className.split(/\s+/); }
  function runsOf(window) {
    const real = window.run;
    const runs = [];
    window.run = (input) => { runs.push(input); return real(input); };
    return runs;
  }
  async function drawn(search) {
    const ed = loadEditor(offline, search);
    if (!search) click(ed.document.querySelector('#presets button[data-preset="family4"]'));
    await h.flush();
    assert(!ed.document.getElementById('stage').hidden, 'sanity: the example should have drawn');
    return ed;
  }

  test('the preview starts on a TRMNL X, landscape, full screen, and offers the three panels', async () => {
    const { document } = await drawn();
    assertEqual(document.getElementById('pModel').value, 'x');
    assertEqual(document.getElementById('pView').value, 'full');
    assertEqual(document.getElementById('pOrient').value, 'landscape');
    assert(!document.getElementById('pOrientField').hidden, 'the X is not asked which way up it is');
    const labels = [...document.getElementById('pModel').options].map((o) => o.textContent);
    ['TRMNL X', 'TRMNL OG', 'TRMNL OG B/W/R/Y'].forEach((name) =>
      assert(labels.some((l) => l.indexOf(name + ' ·') === 0), 'no ' + name + ' in ' + labels.join(' | ')));
    const cls = classesOf(document);
    ['screen--v2', 'screen--lg', 'screen--4bit', 'screen--density-2x'].forEach((c) => assert(cls.includes(c), 'missing ' + c));
    assert(!cls.includes('screen--portrait'), 'drawn in portrait');
    assertEqual(screen(document).style.width, '1040px');
    assert(document.querySelector('#stageInner .view.view--full'), 'not a full view');
    assertEqual(document.querySelector('#stageInner .metro-canvas').getAttribute('data-metro-view'), '1');
  });

  // A color panel carries its palette class in place of a bit depth: with
  // screen--1bit beside it the framework turns red and yellow back into grays.
  test('the B/W/R/Y OG draws in its palette, in the inks the panel prints, and is not asked about orientation', async () => {
    const { document } = await drawn();
    fireChange(document.getElementById('pModel'), 'bwry');
    await h.flush();
    assert(document.getElementById('pOrientField').hidden, 'an OG is asked which way up it is');
    const cls = classesOf(document);
    ['screen--og', 'screen--md', 'screen--density-1x', 'screen--color-4bwry', 'screen--preview-colors', 'screen--preview-white-limited']
      .forEach((c) => assert(cls.includes(c), 'missing ' + c + ': ' + cls.join(' ')));
    ['screen--1bit', 'screen--2bit', 'screen--4bit', 'screen--portrait'].forEach((c) => assert(!cls.includes(c), 'has ' + c));
    assertEqual(screen(document).style.width, '800px');
  });

  test('changing the view under a drawn board redraws it into a mashup slot, without a stale warning', async () => {
    const { window, document } = await drawn();
    const runs = runsOf(window);
    fireChange(document.getElementById('pView'), 'quadrant');
    await h.flush();
    assertEqual(runs.length, 1);
    const stage = document.getElementById('stage');
    assert(stage.className.indexOf('stale') === -1, 'the redrawn board is greyed out');
    const mashup = document.querySelector('#stageInner .mashup');
    assert(mashup && mashup.classList.contains('mashup--2x2'), 'no 2x2 mashup');
    assertEqual(mashup.querySelectorAll('.view.view--quadrant').length, 4);
    assertEqual(document.querySelector('#stageInner .metro-canvas').getAttribute('data-metro-view'), '2');
    assert(classesOf(document).includes('screen--v2'), 'the quadrant left the X');

    fireChange(document.getElementById('pOrient'), 'portrait');
    await h.flush();
    assertEqual(runs.length, 2);
    assert(classesOf(document).includes('screen--portrait'), 'portrait did not reach the screen');
    assertEqual(screen(document).style.width, '780px');

    // Portrait is the X's: another panel drops it rather than drawing an OG on its side.
    fireChange(document.getElementById('pModel'), 'og');
    await h.flush();
    assert(!classesOf(document).includes('screen--portrait'), 'an OG was drawn in portrait');
    assertEqual(screen(document).style.width, '800px');
  });

  test('picking a device before anything is drawn draws nothing', async () => {
    const { window, document } = loadEditor(offline);
    const runs = runsOf(window);
    fireChange(document.getElementById('pModel'), 'ogv2');
    fireChange(document.getElementById('pView'), 'half_vertical');
    await h.flush();
    assertEqual(runs.length, 0);
    assert(document.getElementById('stage').hidden, 'a board appeared');
  });

  // Links and screenshots in the wild still say device=hh and the like.
  test('an old ?device= link opens on the device it always meant, and the new spelling works too', async () => {
    const cases = {
      og: ['og', 'full', 'landscape', 'screen--1bit'], ogv2: ['ogv2', 'full', 'landscape', 'screen--2bit'],
      x: ['x', 'full', 'landscape', 'screen--4bit'], xp: ['x', 'full', 'portrait', 'screen--portrait'],
      hh: ['og', 'half_horizontal', 'landscape', 'screen--1bit'], hv: ['og', 'half_vertical', 'landscape', 'screen--1bit'],
      q: ['og', 'quadrant', 'landscape', 'screen--1bit'],
    };
    for (const [old, [model, view, orient, cls]] of Object.entries(cases)) {
      const { document } = await drawn('?example=family4&device=' + old);
      assertEqual([old, document.getElementById('pModel').value, document.getElementById('pView').value,
        document.getElementById('pOrient').value], [old, model, view, orient]);
      assert(classesOf(document).includes(cls), old + ' drew without ' + cls);
      assert(document.querySelector('#stageInner .view.view--' + view), old + ' is not a ' + view + ' view');
    }
    const { document } = await drawn('?example=family4&model=bwry&view=half_horizontal');
    assertEqual([document.getElementById('pModel').value, document.getElementById('pView').value], ['bwry', 'half_horizontal']);
    assert(classesOf(document).includes('screen--color-4bwry'), 'model=bwry drew without its palette');
    assert(document.querySelector('#stageInner .mashup--1Tx1B'), 'view=half_horizontal is not a top and bottom mashup');
  });
};
