'use strict';

// THE CLOCK UNDER A NAME IS ONE SIZE PER BOARD.
//
// A caption's time is set a step under its name so the name reads first.
// Under the xlarge names the X takes that gap ran to two steps and the time
// came out as a footnote ("time labels in the captions could be a bit
// larger"), so the drawing steps it up afterwards, out of depth that is
// already free (draw.js, bigClocks).
//
// It cannot be a form in the ladder -- measured three ways, every one of
// them cost captions and times, because a taller row is depth and depth is
// what a time row is paid out of (measure-dom's TIME_BIG_CLS) -- and it
// happens in the real DOM, after the solve, so this is the suite that can
// see it at all: offline there are no elements to measure or to grow.
//
// What has to hold is that the step is taken by a whole board at a time.
// Growing each caption on its own merits would set the ones below their rails
// larger and the ones above them smaller, which reads as a mistake rather
// than as a decision. Asked of the captions set in the SAME NAME SIZE: a
// board may carry an xlarge name and a merged list at `large` beside it, and
// each clock is sized against the name it stands under.

module.exports = function (test, h) {
  const { layout, fixtures, VIEWPORTS, assert } = h;
  // the caption is one element to the report; its clock is the child the
  // harness names in `timeCls`
  const stacked = (l) => l.timeCls && !/metro-inline/.test(l.timeCls);
  const sizeOf = (cls) => (/text--base/.test(cls) ? 'base' : /text--small/.test(cls) ? 'small' : 'other');

  for (const fx of fixtures) {
    test('every clock under the same size of name matches: ' + fx.name, () => {
      const bad = [];
      for (const v of VIEWPORTS) {
        const rep = layout(fx, v);
        if (!rep.debug) continue;
        // the stacked form only: a time set beside its name shares the
        // name's line and is not what this is about
        const byName = {};
        rep.labels.filter(stacked).forEach((l) => {
          const nm = /text--xlarge/.test(l.titleCls) ? 'xlarge'
            : /text--large/.test(l.titleCls) ? 'large' : 'base';
          (byName[nm] = byName[nm] || []).push(sizeOf(l.timeCls));
        });
        Object.keys(byName).forEach((nm) => {
          const kinds = byName[nm].filter((s, i) => byName[nm].indexOf(s) === i);
          if (kinds.length > 1) bad.push(v.name + '/' + nm + ': ' + kinds.join(' and '));
        });
      }
      assert(!bad.length, bad.slice(0, 3).join('; '));
    });
  }

  // AND IT IS ACTUALLY TAKEN, on a board with room under every caption.
  // Without this the rule above is satisfied by never stepping up at all,
  // which is what the first two attempts at this did.
  test('a board with room under its captions steps its clocks up', () => {
    const v = VIEWPORTS.find((x) => x.name === 'x-landscape');
    const seen = [];
    for (const fx of fixtures) {
      const rep = layout(fx, v);
      if (!rep.debug) continue;
      const times = rep.labels.filter(stacked);
      if (!times.length) continue;
      seen.push(fx.name + ':' + sizeOf(times[0].timeCls));
    }
    assert(seen.length, 'no board on the X drew a stacked time row at all');
    assert(seen.some((s) => /:base$/.test(s)),
      'not one board took the step: ' + seen.slice(0, 8).join(' '));
  });
};
