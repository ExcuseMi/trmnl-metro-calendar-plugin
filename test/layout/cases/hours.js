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
        const stations = (rep.circles || []).filter((c) => c.role === 'hour-station' || c.role === 'hour-station-minor')
          .map((c) => c.x + c.w / 2).sort((p, q) => p - q);
        const labs = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-hour ') >= 0 && hourOf(l.text) != null)
          .map((l) => ({ x: l.x + l.w / 2, w: l.w, hr: hourOf(l.text), text: l.text })).sort((p, q) => p.x - q.x);
        if (labs.length < 2) return;
        // the hours along the strip, the day's wrap unwound
        let add = 0;
        labs.forEach((l, i) => { if (i && l.hr + add <= labs[i - 1].abs) add += 24; l.abs = l.hr + add; });
        let step = 0;
        labs.forEach((l, i) => { if (i) step = gcd(step, l.abs - labs[i - 1].abs); });
        if (!step) return;
        // every word over its own station (a word at the paper's edge is
        // held inside the canvas's inset, a little over half its width off
        // its hour)
        const W = rep.canvas.w;
        const own = labs.map((l) => {
          let best = -1;
          stations.forEach((s, i) => { if (best < 0 || Math.abs(s - l.x) < Math.abs(stations[best] - l.x)) best = i; });
          const atEdge = l.x - l.w <= 2 || l.x + l.w >= W - 2;
          const off = best < 0 ? Infinity : Math.abs(stations[best] - l.x);
          assert(off <= (atEdge ? l.w * 0.6 : l.w / 3) + 3, '"' + l.text + '" has no station under it');
          return best;
        });
        // and the hours between two words are stations, bar the midnight the
        // panels change at, the slope and the train (two at most)
        for (let i = 1; i < labs.length; i++) {
          const a = labs[i - 1], b = labs[i];
          const hidden = (b.abs - a.abs) / step - 1;
          if (hidden <= 0) continue;
          const between = own[i] - own[i - 1] - 1;
          assert(between >= hidden - 2, hidden + ' hour(s) between "' + a.text + '" and "' + b.text + '" and ' + between + ' station(s)');
        }
      });
    }
  }
};
