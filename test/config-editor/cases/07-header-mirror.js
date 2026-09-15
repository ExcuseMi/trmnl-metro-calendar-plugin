'use strict';

// The preview against the template, outside the map.
//
// tools/config-editor.html previews a board by running the real transform.js
// and the real layout script out of shared.liquid. Anything the template does
// in LIQUID, the editor cannot run, so it had to be hand-built in JS -- and
// two implementations of the same band drift. They had drifted four ways at
// once: the editor drew a window pill the template had dropped, a swatch
// legend the board has never had, laid the header out as one flat row where
// the template stacked, and used its own grey classes.
//
// THE DRIFT IS GONE BECAUSE THE BAND IS. The hour strip is the header now, and
// the layout script draws every part of it: which day this is, what the day is
// (a holiday), and what the sky is doing. The preview runs that script, so it
// gets all of it free and exactly right, and there is nothing left to keep in
// step by hand.
//
// So these cases changed their job. They no longer compare two headers; they
// hold the template to having ONE implementation, and they hold the preview to
// still showing the two things the board cannot say for itself -- which the
// template states under the map, and which are the reason a config author is
// in this tool at all.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '../../..');
const LIQUID = fs.readFileSync(path.join(REPO, 'plugin/src/shared.liquid'), 'utf-8');
const EDITOR = fs.readFileSync(path.join(REPO, 'tools/config-editor.html'), 'utf-8');

// The template's markup: everything before its <style>, with the Liquid
// comments taken out. The comments explain what was REMOVED and name the
// classes and fields it no longer draws, so a test reading the file rather
// than the markup passes or fails on prose.
function templateMarkup() {
  const end = LIQUID.indexOf('<style>');
  const src = end < 0 ? LIQUID : LIQUID.slice(0, end);
  return src.replace(/\{%-?\s*comment[\s\S]*?endcomment\s*-?%\}/g, '');
}

function editorAlerts() {
  const a = EDITOR.indexOf('function renderAlerts(');
  if (a < 0) throw new Error('the editor has no renderAlerts');
  const b = EDITOR.indexOf('\n  }', a);
  return EDITOR.slice(a, b);
}

module.exports = function (test, h) {
  const { assert, assertEqual } = h;

  test('the template draws nothing above the map for the preview to mirror', () => {
    // The whole reason those two implementations existed. A header's height
    // comes off the canvas the layout engine is handed, so a preview with a
    // header of a different height was previewing a different board -- and
    // the only way to be sure it is the same board is for there to be one
    // header, drawn by the one script both of them run.
    const markup = templateMarkup();
    assert(markup.indexOf('metro-header') < 0,
      'the template has a header band again: the preview needs to mirror it, and this case needs to go back to comparing them');
    assert(markup.indexOf('metro-mark') < 0,
      'the template carries the logo again, which is a second thing to keep in step');
    assert(EDITOR.indexOf('function renderHeader(') < 0,
      'the editor builds a header the template does not draw');
  });

  test('the day, the holiday and the forecast are drawn by the script both sides run', () => {
    // Which means the preview cannot get them wrong. Stated as an assertion
    // because it is the thing that replaced the mirroring: if any of these
    // moves back into Liquid, the drift comes back with it.
    // NAMED BY WHAT THEY ARE, not by the function that used to draw them.
    // The old engine had a `dayBadge` and a `metro-holiday-name`; the solver
    // draws the same three facts as board FURNITURE -- ink declared before
    // the layout runs, so the caption search routes around it. What this
    // case is protecting is that all three are drawn by the script both
    // sides run, and that is still exactly what it asks.
    assert(/kind: 'date'/.test(LIQUID), 'the script stopped drawing the date');
    assert(/kind: 'weather'/.test(LIQUID), 'the script stopped drawing the forecast');
    assert(/statesFor/.test(LIQUID), 'the script stopped drawing all-day events');
    assert(templateMarkup().indexOf('metro-holiday') < 0,
      'the holiday is back in the markup, where the preview cannot run it');
    assert(templateMarkup().indexOf('metro-temp') < 0,
      'the forecast is back in the markup, where the preview cannot run it');
  });

  test('the preview does not print what the payload no longer shows', () => {
    // window_label still travels in the payload for the small views, and the
    // board stopped stating it. The preview kept the pill for months.
    assert(templateMarkup().indexOf('metro-window') < 0, 'the template states the window again');
    assert(EDITOR.indexOf('window_label') < 0, 'the preview still prints the window pill');
  });

  test('the preview shows the two things the board cannot say for itself', () => {
    // A feed that has been down for hours and a forecast replayed from saved
    // state. The first one is the reason a config author is in this tool at
    // all: a URL that 404s has to look like a URL that 404s.
    const ed = editorAlerts();
    assert(/calendars_down/.test(ed), 'the preview hides a calendar that is down');
    assert(/weather_stale/.test(ed), 'the preview hides a stale forecast');
  });

  test('it puts them where the board puts them', () => {
    // Under the map, not over it: they are rare, they are prose, and whatever
    // sits above the map takes height off it. Same classes on both sides, so
    // they are the same height when they do appear.
    const markup = templateMarkup();
    const canvasAt = markup.indexOf('metro-canvas');
    const alertAt = markup.indexOf('metro-alerts');
    assert(canvasAt > 0 && alertAt > canvasAt,
      'the template puts its alert lines above the map, where they cost it height');
    for (const cls of ['metro-alerts', 'label--small', 'px--3', 'flex-none']) {
      assert(editorAlerts().indexOf(cls) >= 0,
        'the preview alert line is missing ' + cls + ', so it is not the height the board draws');
    }
  });
};
