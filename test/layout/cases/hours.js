'use strict';

// A STATION FOR EVERY HOUR OF THE STEP (rule 2n). The night runs at a
// quarter of the day's rate and a clock pill takes the hour it stands on,
// so the words cannot follow the whole scale; "hours on the timeline are
// not very consistent, many are missing" was the strip saying 4pm, then
// 10pm, then 6am, then 10am. Every hour of the step keeps a station on the
// rail, a smaller one where its words did not fit, and every word stands
// over its own station.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, textLabels, assert } = h;
  const views = ['x-landscape', 'og-landscape'].map((n) => VIEWPORTS.find((v) => v.name === n));

  function hourOf(text) {
    let m = /^(\d{1,2})(?::(\d\d))?\s*(am|pm)$/i.exec(text.trim());
    if (m) return (+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0);
    m = /^(\d{1,2}):00$/.exec(text.trim());
    return m ? +m[1] : null;
  }
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  for (const v of views) {
    for (const f of fixtures) {
      test('every hour of the step has a station on the rail: ' + f.name + ' / ' + v.name, () => {
        const rep = layout(f, v);
        if (!rep.debug || !rep.debug.horizontal) return;
        // (a night hour is a star and the midnight a moon: paths, placed
        // by the middle of their extent)
        const stations = (rep.circles || []).filter((c) => c.role === 'hour-station' || c.role === 'hour-station-minor')
          .map((c) => c.x + c.w / 2)
          .concat((rep.paths || []).filter((p) => p.role === 'hour-station-minor' && p.pts.length).map((p) => {
            const xs = p.pts.map((q) => q[0]);
            return (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2;
          }))
          .sort((p, q) => p - q);
        // the midnight the panels change at has its station ("missing the
        // 00:00 dot")
        const bands = (rep.rects || []).filter((r) => r.role === 'river').sort((p, q) => p.x - q.x);
        if (bands.length > 1) {
          const cut = bands[1].x;
          assert(stations.some((s) => Math.abs(s - cut) <= 3), 'no station at the midnight (' + Math.round(cut) + ')');
        }
        // and the train rides over its station, not in a gap left for it
        const labs = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-hour ') >= 0 && hourOf(l.text) != null)
          .map((l) => ({ x: l.x + l.w / 2, w: l.w, hr: hourOf(l.text), text: l.text })).sort((p, q) => p.x - q.x);
        if (labs.length < 2) return;
        // the hours along the strip, the day's wrap unwound
        let add = 0;
        labs.forEach((l, i) => { if (i && l.hr + add <= labs[i - 1].abs) add += 24; l.abs = l.hr + add; });
        let step = 0;
        labs.forEach((l, i) => { if (i) step = gcd(step, l.abs - labs[i - 1].abs); });
        if (!step) return;
        // every word over its own station
        const W = rep.canvas.w;
        const own = labs.map((l) => {
          let best = -1;
          stations.forEach((s, i) => { if (best < 0 || Math.abs(s - l.x) < Math.abs(stations[best] - l.x)) best = i; });
          const off = best < 0 ? Infinity : Math.abs(stations[best] - l.x);
          // (a label may slide up to half its width to clear the clock, and
          // is never held off its station by the edge)
          assert(off <= l.w / 2 + 3, '"' + l.text + '" has no station under it');
          return best;
        });
        // and no stretch of the rail is bare: no two neighbouring stations
        // are further apart than one step of the labels at the day's
        // fullest rate, the widest a station step can ever be (a squeezed
        // night is thinned to a dot's width apart, never more)
        // (per step of the labels, over every pair of neighbouring labels:
        // the scale runs at more than one rate, so the widest step is
        // wherever the day is busiest)
        let full = 0;
        for (let i = 1; i < labs.length; i++) {
          full = Math.max(full, (stations[own[i]] - stations[own[i - 1]]) / ((labs[i].abs - labs[i - 1].abs) / step));
        }
        if (!full) return;
        for (let i = 1; i < stations.length; i++) {
          assert(stations[i] - stations[i - 1] <= full + 3, 'a bare stretch of rail: ' + Math.round(stations[i - 1]) + ' to ' + Math.round(stations[i]) + ', over the ' + Math.round(full) + ' of a full step');
        }
      });

      // AND THE STEP IS AS FINE AS THE RAIL CAN CARRY. The dots' step was
      // taken from the TIGHTEST hour on the board and the words were
      // rounded up to a multiple of it, so a lead-in two pixels short of
      // the dots' clearance put the whole day on two-hour words: twelve
      // hours of panel with five labels on it, room for eleven ("why isn't
      // it showing hourly here"). Where a station stands clear of both its
      // neighbouring words by the width a word is placed at, a word
      // belonged on it.
      test('the hour words are as fine as the rail can carry: ' + f.name + ' / ' + v.name, () => {
        const rep = layout(f, v);
        if (!rep.debug || !rep.debug.horizontal) return;
        const all = textLabels(rep);
        const labs = all.filter((l) => (' ' + l.cls + ' ').indexOf(' metro-hour ') >= 0 && hourOf(l.text) != null)
          .map((l) => ({ x: l.x + l.w / 2, w: l.w, text: l.text })).sort((p, q) => p.x - q.x);
        if (labs.length < 2) return;
        const stations = (rep.circles || []).filter((c) => c.role === 'hour-station' || c.role === 'hour-station-minor')
          .map((c) => c.x + c.w / 2).sort((p, q) => p - q);
        // the clock's own pill takes an hour off the words, and so does the
        // midnight a panel changes at: a gap kept for either is not a step
        // too coarse
        const keepOut = all.filter((l) => (' ' + l.cls + ' ').indexOf(' metro-axis-note ') >= 0)
          .map((l) => [l.x - 4, l.x + l.w + 4])
          .concat((rep.rects || []).filter((r) => r.role === 'river').map((r) => [r.x - 4, r.x + r.w + 4]));
        for (let i = 1; i < labs.length; i++) {
          // what the drawing books a word at: its own width and a little
          // over, centre to centre (draw.js `room`), with a quarter again
          // so a word a few pixels short of fitting is not a failure
          // (the drawing books in its own units; the harness measures the
          // screen, so the clearance is carried across at the same ratio)
          const Z = rep.debug.W ? rep.canvas.w / rep.debug.W : 1;
          const room = 1.25 * (Math.max(labs[i].w, labs[i - 1].w) + 10 * (rep.debug.S || 1) * Z);
          const spare = stations.filter((s) => s - labs[i - 1].x >= room && labs[i].x - s >= room
            && !keepOut.some((k) => s > k[0] && s < k[1]));
          assert(!spare.length, 'a word belonged between "' + labs[i - 1].text + '" and "' + labs[i].text
            + '": ' + spare.length + ' station(s) clear of both by ' + Math.round(room) + 'px');
        }
      });
    }
  }
};
