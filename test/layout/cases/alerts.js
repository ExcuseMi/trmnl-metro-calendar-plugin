'use strict';

// WHAT THE BOARD SAYS WHEN SOMETHING WENT WRONG.
//
// A calendar that did not answer is not on the map, and every other thing on
// the map looks exactly as it always does -- so unless the board says so, a
// reader cannot tell a quiet Tuesday from a feed that failed. Two photographs
// of one real board six minutes apart lost different people's events each
// time and said nothing either time: the line existed, but a feed was only
// NAMED after it had been failing for two hours, and nothing in any suite had
// ever looked at the line at all.
//
// So: it appears on the render the failure happened on, it carries a mark, it
// is set in the board's own ink rather than the grey used for a clock, and it
// does not cost the map a row it was using.

module.exports = function (test, h) {
  const { layout, fixtures, VIEWPORTS, assert } = h;
  const busy = fixtures.find((f) => f.name === 'busy-day');
  const DOWN = { calendars_down: ['Alex Personal'] };

  test('a feed that did not answer is named on the board, with a mark', () => {
    for (const v of VIEWPORTS) {
      const rep = layout(busy, v, DOWN);
      const said = (rep.alerts || []).filter((a) => a.text.indexOf('Alex Personal') >= 0);
      assert(said.length === 1, v.name + ': the board did not say the feed was unavailable: '
        + JSON.stringify(rep.alerts));
      assert(said[0].icon, v.name + ': the line carries no mark, so it reads as a footnote');
      assert(said[0].icon.w > 4 && said[0].icon.h > 4, v.name + ': the mark is '
        + Math.round(said[0].icon.w) + 'x' + Math.round(said[0].icon.h) + 'px, which is not a mark');
      // Not the quiet grey: this is the one line on the board that is about
      // the board being wrong.
      assert(+said[0].weight >= 700, v.name + ': the warning is set at weight '
        + said[0].weight + ', the same as everything else');
    }
  });

  test('a board with nothing wrong says nothing, so the mark means something', () => {
    for (const v of VIEWPORTS) {
      const rep = layout(busy, v);
      assert(!(rep.alerts || []).length, v.name + ': a healthy board raised a warning: '
        + JSON.stringify(rep.alerts));
    }
  });

  test('the warning does not push the board off its own panel', () => {
    // It is a row under the map and the map is sized around it; a warning
    // that overflowed would cost the reader the bottom line to tell them
    // about the one that is missing.
    for (const v of VIEWPORTS) {
      const rep = layout(busy, v, DOWN);
      const h = v.slot ? v.slot.h : v.h;
      (rep.alerts || []).forEach((a) => {
        assert(a.y + a.h <= h + 1, v.name + ': the warning reaches ' + Math.round(a.y + a.h)
          + 'px on a ' + h + 'px panel');
      });
    }
  });
};
