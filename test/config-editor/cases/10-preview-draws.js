const fs = require('fs');
const path = require('path');

// THE PREVIEW RAN THE PLUGIN'S TEMPLATE WITH THE LIQUID STILL IN IT.
//
// drawMap takes the layout engine out of plugin/src/shared.liquid and runs
// it verbatim, with the payload pasted in where the template writes its
// Liquid tag. It found that tag by searching for a literal copy of the
// tag's text -- and the tag had since been renamed, from
// `{{ metro | json }}` to `{{ data | json }}`. A String#replace that
// matches nothing does not complain, so `window.METRO = {{ data | json }};`
// went straight into `new Function`, and every single draw died on the
// syntax error that is. Chrome called it "Unexpected token '{'", Firefox
// "expected property name, got '{'", and the page dressed either one up as
// "The map could not be drawn", which sent people hunting for a bad
// calendar or a bad rule in a config that was fine.
//
// So this draws a real board from a real config and insists it comes out.
// `window.METRO` is the proof the engine compiled and ran: jsdom has no
// layout, so the drawing itself measures a zero-sized canvas and stops,
// but nothing can set that global unless the payload landed in the script.
module.exports = function (test, h) {
  const { loadEditor, click, assert } = h;
  const REPO_ROOT = path.join(__dirname, '../../..');

  const ICS = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:1', 'SUMMARY:Jules swimming',
    'DTSTART:20260911T090000Z', 'DTEND:20260911T100000Z', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');

  function fetchStub(url) {
    const u = String(url);
    if (/shared\.liquid$/.test(u)) {
      const src = fs.readFileSync(path.join(REPO_ROOT, 'plugin/src/shared.liquid'), 'utf-8');
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(src) });
    }
    if (/\.ics$/.test(u)) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(ICS) });
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
  }

  // The shape the bug was reported with: one rule whose match is a nested
  // and-matcher, another that puts its events on two lines at once.
  const CONFIG = {
    timeZone: 'Europe/Brussels',
    lines: [{ name: 'Jules' }, { name: 'Remy' }],
    calendars: [{
      url: 'https://example.com/a.ics',
      rules: [
        { match: { type: 'and', matchers: [{ type: 'word', value: 'swim' }, { type: 'word', value: 'Jules' }] }, line: 'Jules' },
        { match: { type: 'word', value: 'family' }, line: ['Jules', 'Remy'] },
      ],
    }],
  };

  test('the preview draws a board instead of dying on the template\'s Liquid', async () => {
    const { window, document } = loadEditor(fetchStub);
    document.getElementById('importIn').value = JSON.stringify(CONFIG);
    click(document.getElementById('loadImport'));
    click(document.getElementById('runPreview'));
    await h.flush();
    const status = document.getElementById('previewStatus');
    assert(status.className.indexOf('err') === -1, 'the preview reported an error: ' + status.textContent);
    assert(window.METRO && typeof window.METRO === 'object', 'the layout engine never ran, so nothing was drawn');
    assert(Array.isArray(window.METRO.events), 'the engine ran without the payload: ' + JSON.stringify(Object.keys(window.METRO || {})));
    assert(document.getElementById('stage').hidden === false, 'the stage stayed hidden');
  });

  // And the drift itself, caught where it happens rather than three steps
  // later in a message about a map: the editor has to be able to find the
  // assignment it means to overwrite in the template that ships today.
  test('the editor can find the template\'s payload assignment', () => {
    const editor = fs.readFileSync(path.join(REPO_ROOT, 'tools/config-editor.html'), 'utf-8');
    const liquid = fs.readFileSync(path.join(REPO_ROOT, 'plugin/src/shared.liquid'), 'utf-8');
    const m = editor.match(/var TAG = (\/.*\/);/);
    assert(m, 'config-editor.html no longer has a TAG pattern for the payload assignment');
    const tag = new RegExp(m[1].slice(1, -1));
    assert(tag.test(liquid), 'the editor\'s pattern matches nothing in plugin/src/shared.liquid');
  });
};
