'use strict';

// A BOARD THAT CROSSES A MIDNIGHT NAMES THE DAY IT CROSSES INTO, ON THE STRIP.
//
// Whether a board crosses, where tomorrow's events land and whether a name
// straddles the midnight are the solver's answers and asked in test/boards
// (cases/window.js). What is left is the badge: the framework lays it out, so
// only a real page can say where it is drawn and what it is drawn over.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, textLabels, overlap, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const ROOMY = byName('x-landscape');
  const base = fixtures.find((f) => f.name === 'rolling-quiet');
  // Five in the afternoon: little left today, so the board reaches tomorrow.
  const roll = { name: 'rolling-evening', metro: Object.assign({}, base.metro, { now_min: 17 * 60 }) };

  const hasCls = (l, c) => (' ' + l.cls + ' ').indexOf(' ' + c + ' ') >= 0;
  const daybreaks = (rep) => rep.labels.filter((l) => hasCls(l, 'metro-daybreak'));
  const midnightX = (rep) => {
    // (the unpainted marker at the cut: the rule itself is no longer drawn)
    const m = (rep.rects || []).filter((p) => p.role === 'midnight-cut')[0];
    return m ? m.x + m.w / 2 : null;
  };

  test('the second day is named on the strip, where the midnight is', () => {
    for (const v of [ROOMY, byName('og-landscape')]) {
      const rep = layout(roll, v);
      const mid = midnightX(rep);
      assert(mid != null, v.name + ': the evening board drew no midnight');
      const marks = daybreaks(rep);
      assert(marks.length >= 1, v.name + ': no date marker at all on a two-day board');
      // It names the day the midnight OPENS, so it starts at that midnight.
      assert(marks.some((l) => Math.abs(l.x - mid) < l.w + 20), v.name + ': the date marker is at x'
        + Math.round(marks[0].x) + ' and the midnight is at x' + Math.round(mid));
    }
  });

  test('a date marker has nothing written over it', () => {
    for (const v of [ROOMY, byName('og-landscape'), byName('og-half')]) {
      const rep = layout(roll, v);
      const others = textLabels(rep).filter((l) => !hasCls(l, 'metro-daybreak'));
      const bad = [];
      for (const m of daybreaks(rep)) {
        for (const o of others) {
          const ov = overlap(m, o);
          if (ov && ov.w > 1 && ov.h > 1) bad.push('"' + m.text + '" over "' + o.text + '"');
        }
      }
      assert(bad.length === 0, v.name + ': ' + bad.join('; '));
    }
  });
};
