'use strict';

// Regression tests for tools/config-editor.html: the page is loaded into jsdom together with
// plugin/src/transform.js, then driven like a person would (type, click, read #jsonOut).
// Run with: npm test (from this directory). Installs jsdom on first run; no browser needed.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.join(__dirname, '../..');
const EDITOR_HTML = fs.readFileSync(path.join(REPO_ROOT, 'tools/config-editor.html'), 'utf-8');
const TRANSFORM_SRC = fs.readFileSync(path.join(REPO_ROOT, 'plugin/src/transform.js'), 'utf-8');

const INLINE_RE = /<script>([\s\S]*?)<\/script>\s*<\/body>/;
const inline = EDITOR_HTML.match(INLINE_RE);
if (!inline) throw new Error("config-editor.html: inline <script> before </body> not found");
const INLINE_SCRIPT = inline[1];
const SKELETON = EDITOR_HTML.replace(/<script src="\.\.\/plugin\/src\/transform\.js"><\/script>\s*/, '').replace(INLINE_RE, '</body>');

// `fetchImpl` is for the one test that needs the page to read something (the
// preview fetches the plugin's own template). Everything else gets the
// rejecting stub, so a test that reaches the network by accident says so.
// `search` opens the page with a query string, for the cases about links.
function loadEditor(fetchImpl, search) {
  const dom = new JSDOM(SKELETON, { url: 'http://localhost/tools/config-editor.html' + (search || ''), runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = fetchImpl || (() => Promise.reject(new Error('network disabled in tests')));
  window.eval(TRANSFORM_SRC);
  window.eval(INLINE_SCRIPT);
  return { window, document: window.document };
}
const h = {
  loadEditor,
  fireInput(el, value) { if (value !== undefined) el.value = value; el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true })); },
  fireChange(el, value) { if (value !== undefined) el.value = value; el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true })); },
  click(el) { el.dispatchEvent(new el.ownerDocument.defaultView.Event('click', { bubbles: true })); },
  buttonByText(container, text) {
    const b = Array.from(container.querySelectorAll('button')).find((e) => e.textContent.trim() === text);
    if (!b) throw new Error('no button "' + text + '"');
    return b;
  },
  // BY LABEL, NOT BY INDEX. Two tests ticked "hide it from the map" as
  // checkbox number two, which held until the rule card grew a checkbox
  // above it; then they were quietly ticking something else entirely.
  checkByLabel(container, text) {
    const l = Array.from(container.querySelectorAll('label.check'))
      .find((e) => e.textContent.trim().indexOf(text) >= 0);
    if (!l) throw new Error('no checkbox labelled "' + text + '"');
    const box = l.querySelector('input[type=checkbox]');
    if (!box) throw new Error('label "' + text + '" has no checkbox');
    return box;
  },
  // Without the `version` every export carries (cases/35-config-format.js
  // checks it), so a case says only the part of the configuration it is about.
  jsonOut(document) { const c = JSON.parse(document.getElementById('jsonOut').value); delete c.version; delete c.docs; return c; },
  // THE FLOW THE TOOL HAS. A link, who it is for, press the button: that is
  // the only way to add a calendar and the only way a person comes into
  // existence, so every case that needs either sets them up through here
  // rather than by reaching into a card the page no longer draws. It used to
  // take two halves -- type a name into a blank line card, then type a URL
  // into a blank calendar card and ctrl-click the name in a multi-select --
  // and the tests were the last thing still doing it that way.
  addFeed(document, url, who) {
    h.fireInput(document.getElementById('newUrl'), url);
    if (who !== undefined) h.fireInput(document.getElementById('newWho'), who);
    h.click(document.getElementById('addCalendar'));
    return [...document.querySelectorAll('#calendars .card')].pop();
  },
  // The card for the last calendar added, and its answer box.
  whoBox(card) { return card.querySelector('input.who-input'); },
  // A rule's "put it on the line of": one tick per person.
  selectMulti(picker, values) {
    Array.from(picker.querySelectorAll('input[type=checkbox]')).forEach((b) => {
      const want = values.indexOf(b.value) !== -1;
      if (b.checked === want) return;
      b.checked = want;
      b.dispatchEvent(new b.ownerDocument.defaultView.Event('change', { bubbles: true }));
    });
  },
  assert,
  assertEqual(a, b) { assert.deepStrictEqual(a, b); },
  // The preview is a promise chain several links long. Nothing in it waits
  // on a timer, so draining the microtask queue a few hundred times is
  // enough to let it run to its end (or to its catch) before we look.
  async flush(n) {
    for (let i = 0; i < (n || 200); i++) await new Promise((r) => setImmediate(r));
  },
};

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const casesDir = path.join(__dirname, 'cases');
fs.readdirSync(casesDir).filter((f) => f.endsWith('.js')).sort().forEach((f) => require(path.join(casesDir, f))(test, h));

// `await` on every case, so a case may be async. A test that returned a
// promise would otherwise pass by being a promise: nothing waited for it,
// and whatever it asserted was thrown away.
(async () => {
  let failed = 0;
  // CE_ONLY=<words> runs the cases whose names contain them, with the whole
  // assertion message (the deep-equal diff) rather than its first lines.
  const only = process.env.CE_ONLY;
  const run = only ? tests.filter((t) => t.name.indexOf(only) >= 0) : tests;
  for (const t of run) {
    try { await t.fn(); console.log('✓ ' + t.name); }
    catch (e) { failed++; console.log('✗ ' + t.name + '\n  ' + (only ? (e && e.message) : (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n  ') : e))); }
  }
  console.log(`\n${run.length - failed}/${run.length} passed`);
  process.exit(failed ? 1 : 0);
})();
