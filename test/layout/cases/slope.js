'use strict';

// NOTHING ON TOMORROW'S PANEL STANDS UNDER THE SLOPE (rule 2l). Today's
// ink panel runs on over the midnight at 45 degrees, covering the start of
// each of tomorrow's rows by as much as the row stands above the rail. A
// title measured without it was chosen too long and pulled back under the
// ink, and the OG read "orrow" for "Tomorrow" whenever today's header
// carried the Now card.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, assert } = h;
  const views = ['x-landscape', 'og-landscape'].map((n) => VIEWPORTS.find((v) => v.name === n));

  for (const v of views) {
    for (const f of fixtures) {
      if (!((f.metro.days || []).length > 1)) continue;
      test('tomorrow\'s words clear the slope: ' + f.name + ' / ' + v.name, () => {
        const rep = layout(f, v);
        if (!rep.debug || !rep.debug.horizontal) return;
        const bands = (rep.rects || []).filter((r) => r.role === 'river').sort((p, q) => p.x - q.x);
        if (bands.length < 2) return;
        const S = rep.debug.S || 1, cut = bands[1].x, stripC1 = bands[0].y + bands[0].h;
        const slantMax = Math.min(bands[0].h, Math.floor(bands[1].w * 0.4));
        if (slantMax < 8 * S) return;
        const bad = rep.labels.filter((l) => {
          if (!/metro-daybadge|metro-wx|metro-hour|metro-axis-note/.test(l.cls)) return false;
          if (l.y + l.h > stripC1 + 1 || l.x + l.w / 2 < cut) return false;
          const reach = Math.min(slantMax, Math.max(0, stripC1 - l.y - 2 * S));
          return l.x < cut + reach - 2;
        });
        assert(!bad.length, bad.map((l) => '"' + l.text + '" starts ' + Math.round(cut + Math.min(slantMax, stripC1 - l.y - 2 * S) - l.x) + 'px under the slope').join('; '));
      });
    }
  }
};
