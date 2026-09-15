'use strict';

const fs = require('fs');
const path = require('path');

// WHAT UNDO PUTS BACK HAS TO BE EVERYTHING THE LOAD TOOK.
//
// Undo restores the editor from a deep copy of its own state, which is the
// right shape for it, but it was putting back a hand-listed four fields out
// of six. The two it missed are the two this page deliberately has no
// control for -- the clock and the temperature unit -- so nothing on screen
// showed them coming or going, and a config that went in reading "12h" came
// back out of an undo reading whatever the last load happened to leave.

module.exports = function (test, h) {
  const { loadEditor, click, jsonOut, assert, assertEqual } = h;
  const REPO_ROOT = path.join(__dirname, '../../..');

  function load(document, cfg) {
    document.getElementById('importIn').value = typeof cfg === 'string' ? cfg : JSON.stringify(cfg);
    click(document.getElementById('loadImport'));
  }

  test('undo takes back a clock setting that arrived with a load', () => {
    const { document } = loadEditor();
    load(document, { timeFormat: '12h', temperatureUnit: 'f', calendars: ['https://a.example/x.ics'] });
    assertEqual(jsonOut(document).timeFormat, '12h', 'sanity: the setting came in with the config');
    click(document.getElementById('undoBtn'));
    const out = jsonOut(document);
    assert(!('timeFormat' in out), 'undo left the clock set to a config that is no longer loaded: ' + JSON.stringify(out));
    assert(!('temperatureUnit' in out), 'undo left the temperature unit behind: ' + JSON.stringify(out));
  });

  test('undo puts a clock setting back when that is what was there before', () => {
    const { document } = loadEditor();
    load(document, { timeFormat: '12h', calendars: ['https://a.example/x.ics'] });
    load(document, 'https://a.example/y.ics');
    click(document.getElementById('undoBtn'));
    assertEqual(jsonOut(document).timeFormat, '12h',
      'undoing back to a 12h configuration silently flipped the board to 24h');
  });

  // AN UNDONE EXAMPLE HAS TO BE THE WHOLE EXAMPLE, FEEDS AND ALL.
  //
  // A preset is a configuration plus the feeds it ships with: the links all
  // point at calendar.example.com, which no browser can fetch, so what makes
  // "Render the example" draw is the ICS text the preset carries. "I'm ready
  // to do this for real" clears both. Undo put the configuration back and
  // not the feeds, so the example returned as seven links to a domain that
  // does not answer, and the next Render drew nothing and reported seven
  // feeds it could not read.
  const stub = (url) => {
    const u = String(url);
    if (/shared\.liquid$/.test(u)) {
      return Promise.resolve({ ok: true, status: 200,
        text: () => Promise.resolve(fs.readFileSync(path.join(REPO_ROOT, 'plugin/src/shared.liquid'), 'utf-8')) });
    }
    // calendar.example.com is deliberately unreachable: the example draws
    // from the text the preset carries or it does not draw at all.
    return Promise.reject(new Error('Failed to fetch'));
  };

  test('undoing "for real" brings the example\'s own feeds back with it', async () => {
    const { window, document } = loadEditor(stub);
    window.confirm = () => true;
    click(document.querySelector('#presets button[data-preset="family4"]'));
    click(document.getElementById('goReal'));
    click(document.getElementById('chooseManual'));
    click(document.getElementById('undoBtn'));
    assert(jsonOut(document).calendars.length > 1, 'sanity: undo put the example configuration back');

    click(document.getElementById('runPreview'));
    await h.flush();
    const status = document.getElementById('previewStatus');
    assert(!/could not be read/.test(status.textContent),
      'the example came back without its feeds, so drawing it failed: ' + status.textContent);
    assert(/event/.test(status.textContent), 'the example drew nothing: ' + status.textContent);
  });
};
