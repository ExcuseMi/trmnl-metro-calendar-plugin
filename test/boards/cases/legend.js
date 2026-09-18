'use strict';

// THE LEGEND'S OWN RULES, asked of the model.
//
// "Clamp the track to certain width and only allow 1 line." "All day events
// should split onto 2 lines." A line's name is cut at a share of the panel
// rather than pushing the legend's column out over the day, and the badge
// under it -- what that line is today -- is at most two lines, split at its
// own break, and never split where the halves would have to be cut to fit
// (day.js wrapTwo): "Verj…" over "Thui…" is two lines that say nothing.

module.exports = function (test, h) {
  const { layout, fixtures, assert } = h;
  const VIEWS = ['x-landscape', 'og-landscape', 'x-portrait', 'og-half'];

  for (const v of VIEWS) {
    test('a line\'s name is booked no wider than the clamp: ' + v, () => {
      const bad = [];
      for (const f of fixtures) {
        const rep = layout(f, v);
        for (const fx of rep.spec.fixed.filter((x) => x.kind === 'terminus')) {
          if (fx.nameMax == null) continue;
          // nameW carries the clearance a caption keeps from the word
          if (fx.nameW - 4 > fx.nameMax + 0.5) bad.push(f.name + ': "' + fx.text + '" booked at '
            + Math.round(fx.nameW - 4) + ', over the clamp of ' + Math.round(fx.nameMax));
        }
      }
      assert(!bad.length, bad.slice(0, 4).join('; '));
    });

    test('a badge is one line, or two whole ones: ' + v, () => {
      const bad = [];
      for (const f of fixtures) {
        const rep = layout(f, v);
        for (const fx of rep.board.fixed.filter((x) => x.kind === 'terminus' && x.route)) {
          const lines = fx.routeLines || [fx.route];
          if (lines.length > 2) bad.push(f.name + ': ' + fx.line + '\'s badge is ' + lines.length + ' lines');
          if (lines.length === 2 && lines.some((l) => /…$/.test(l))) {
            bad.push(f.name + ': ' + fx.line + '\'s badge was split and cut: ' + JSON.stringify(lines));
          }
          // and the booking holds every line of it
          if ((fx.rows || 1) !== 1 + lines.length) bad.push(f.name + ': ' + fx.line + ' booked '
            + fx.rows + ' row(s) for a name and ' + lines.length + ' badge line(s)');
        }
      }
      assert(!bad.length, bad.slice(0, 4).join('; '));
    });
  }

  // THE SPLIT IS AT THE BADGE'S OWN BREAK, where it splits at all.
  test('a badge splits between its state and its day, or between two states', () => {
    const Day = require('../../../solver/day');
    const src = require('fs').readFileSync(require.resolve('../../../solver/day'), 'utf-8');
    const wrapTwo = new Function(src.slice(src.indexOf('function wrapTwo'),
      src.indexOf('return lines.slice(0, 2);\n}') + 'return lines.slice(0, 2);\n}'.length) + '\nreturn wrapTwo;')();
    const w = (t) => t.length * 6;
    assert(JSON.stringify(wrapTwo('Ship Inspection · Wed', 100, w)) === '["Ship Inspection","Wed"]',
      'state and day: ' + JSON.stringify(wrapTwo('Ship Inspection · Wed', 100, w)));
    assert(JSON.stringify(wrapTwo('Night Shift · Sat, Half Term · Sun', 110, w))
      === '["Night Shift · Sat","Half Term · Sun"]',
      'two states: ' + JSON.stringify(wrapTwo('Night Shift · Sat, Half Term · Sun', 110, w)));
    assert(Day.specFor, 'day.js loads');
  });
};
