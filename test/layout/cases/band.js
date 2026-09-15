'use strict';

// The hour scale used to run down the MIDDLE of the board with the lines
// split above and below it, so a grey band cut every person's day in half.
// It is a header now: a strip along the leading edge, with the map running
// the whole depth beside it.

module.exports = function (test, h) {
  const { layout, render, VIEWPORTS, fixtures, pathsWhere, textLabels, overlap, deepestIntrusion, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const ROOMY = byName('x-landscape');
  const busy = fixtures.find((f) => f.name === 'busy-day');

  // "across" is y when the board is lying down and x when it is stood up:
  // every measurement here is on the cross axis, whichever one that is
  const cross = (rep) => (rep.debug.horizontal ? 1 : 0);
  function spanOf(rep, parts) {
    const i = cross(rep);
    let lo = Infinity, hi = -Infinity;
    for (const p of parts) {
      if (p.pts) { for (const q of p.pts) { lo = Math.min(lo, q[i]); hi = Math.max(hi, q[i]); } }
      else { lo = Math.min(lo, i ? p.y : p.x); hi = Math.max(hi, (i ? p.y + p.h : p.x + p.w)); }
    }
    return { lo, hi };
  }
  const shapes = (rep, role) => (rep.paths || []).concat(rep.rects || []).filter((p) => p.role === role);
  function bandOf(rep) { return spanOf(rep, shapes(rep, 'river')); }

  for (const f of fixtures) {
    test('no line crosses the hour band: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const band = bandOf(rep);
      assert(isFinite(band.lo), 'no hour band drawn');
      const bad = [];
      for (const p of pathsWhere(rep, 'track').concat(pathsWhere(rep, 'spur'))) {
        // the strip is a header, so nothing belonging to the map may reach
        // into it — a line that does is the old "band through the middle"
        for (const q of p.pts) if (q[1] < band.hi - 1) { bad.push(p.role + ' ' + p.owner); break; }
      }
      assert(bad.length === 0, bad.length + ' line(s) reaching into the hour band: '
        + [...new Set(bad)].slice(0, 4).join(', '));
    });
  }

  test('the hour band sits at the leading edge, not through the map', () => {
    for (const v of [ROOMY, byName('x-portrait'), byName('og-landscape'), byName('og-half')]) {
      const rep = render(busy.metro, v);
      const band = bandOf(rep);
      const depth = rep.debug.horizontal ? rep.canvas.h : rep.canvas.w;
      assert(band.lo <= 2, v.name + ': the band starts ' + Math.round(band.lo) + 'px in, not at the edge');
      assert(band.hi < depth * 0.35, v.name + ': the band reaches ' + Math.round(band.hi)
        + 'px into a ' + Math.round(depth) + 'px board');
    }
  });

  test('the hours are written on the band', () => {
    const rep = layout(busy, ROOMY);
    const band = bandOf(rep);
    const hours = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-hour ') >= 0);
    assert(hours.length >= 3, 'expected the hour scale, found ' + hours.length + ' hour label(s)');
    const off = hours.filter((l) => l.y < band.lo - 2 || l.y + l.h > band.hi + 2);
    assert(off.length === 0, off.length + ' hour label(s) off the band: '
      + off.map((l) => '"' + l.text + '"').join(', '));
  });

  // Nothing is drawn across the board at "now". A rule there was the one
  // line drawn at a minute rather than belonging to anybody, so nothing
  // routed around it and it cut through captions the whole width of the
  // map. The badge on the scale says what time it is; each line's car says
  // where that person is.
  test('nothing is ruled across the board at a moment in time', () => {
    for (const v of [ROOMY, byName('x-portrait')]) {
      const rep = render(SKY, v);
      // The clock's own rule down the board is the one exception, and it is
      // not ruled FROM the scale: it is a dotted hairline the captions are
      // kept off (day.js, NOW AS A LINE STRAIGHT DOWN THE BOARD).
      const nows = new Set(shapes(rep, 'now'));
      // the sky markers used to drop one too
      const band = bandOf(rep);
      const i = cross(rep);
      const depth = rep.debug.horizontal ? rep.canvas.h : rep.canvas.w;
      const long = (rep.paths || []).filter((p) => !nows.has(p)).filter((p) => {
        const at = p.pts.map((q) => q[i]);
        return Math.max.apply(null, at) - Math.min.apply(null, at) > depth * 0.5
          && Math.min.apply(null, at) < band.hi + 4;
      });
      assert(long.length === 0, v.name + ': ' + long.length
        + ' line(s) still run from the scale across the whole board');
    }
  });

  test('the clock is stated as a badge on the scale', () => {
    const rep = layout(busy, ROOMY);
    const pills = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-pill ') >= 0);
    assert(pills.length === 1, 'expected one clock badge on the scale, found ' + pills.length);
    assert(/\d/.test(pills[0].text), 'the clock badge says "' + pills[0].text + '"');
  });

  // Sky markers used to be set at the very top of the canvas. The hour
  // scale moved there, and nothing said so: a marker's own time was written
  // straight over the hour tick on the strip.
  //
  // These were `type: 'sun'` markers when the board still drew a sunrise
  // and a sunset. Those are gone and `weather` is the only kind left, so
  // the fixtures below are weather markers -- a case feeding a payload the
  // transform can no longer produce proves nothing about the board.
  const SKY = JSON.parse(JSON.stringify(busy.metro));
  const DOT = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>"
    + "<circle cx='12' cy='12' r='6' fill='black'/></svg>";
  SKY.weather = (SKY.weather || []).concat([
    { type: 'weather', at_min: SKY.day_start_min + 40, icon: DOT, label: 'Rain starts 06:40' },
    // deliberately just before the end of the window, where the last hour
    // tick and the "+n more" note both live
    { type: 'weather', at_min: SKY.day_end_min - 12, icon: DOT, label: 'Rain stops 21:48' },
  ]);

  test('a sky marker never lands on the hour scale', () => {
    for (const v of [ROOMY, byName('og-landscape')]) {
      const rep = render(SKY, v);
      const sky = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-sky ') >= 0);
      if (!sky.length) continue;   // too small a board to carry them at all
      const scale = textLabels(rep).filter((l) => {
        const c = ' ' + l.cls + ' ';
        return c.indexOf(' metro-hour ') >= 0 || c.indexOf(' metro-axis-note ') >= 0;
      });
      const bad = [];
      for (const m of sky) for (const t of scale) {
        const o = overlap(m, t);
        if (o && o.w > 1 && o.h > 1) bad.push('"' + m.text + '" over "' + t.text + '"');
      }
      assert(bad.length === 0, v.name + ': ' + bad.length + ' sky marker(s) on the scale: '
        + [...new Set(bad)].join('; '));
      // and below the strip, not floating in it
      const band = bandOf(rep);
      const i = cross(rep);
      // the day's forecast is set IN its strip panel on purpose (rule 2c)
      const inside = sky.filter((m) => (' ' + m.cls + ' ').indexOf(' metro-wx ') < 0 && (i ? m.y : m.x) < band.hi - 1);
      assert(inside.length === 0, v.name + ': ' + inside.length + ' sky marker(s) inside the strip');
    }
  });

  // STANDING UP, A SKY MARKER STAYS IN ITS GUTTER.
  //
  // A standing board sets its sky markers beside the bundle, right-aligned
  // against the first rail, in the gutter between the hour strip and the
  // map. When the text was wider than that gutter the position went
  // negative, a clamp pinned it to the left edge, and the text ran rightward
  // over the hour labels and straight through the rail it was meant to sit
  // beside: "Storms 20:00" written across Homer's line and over "8pm", and
  // the next marker's text printed on top of it, because nothing kept two
  // markers apart along the axis either.
  // On the busy two-person board AND the five-person one: a wide bundle is
  // what leaves the gutter too narrow for the words, and a thin one is what
  // shows the stacking on its own.
  const withSky = (metro) => {
    const m = JSON.parse(JSON.stringify(metro));
    m.weather = (m.weather || []).concat([
      { type: 'weather', at_min: m.day_start_min + 40, icon: DOT, label: 'Rain stops 06:40' },
      { type: 'weather', at_min: m.day_start_min + 300, icon: DOT, label: 'Rain starts 13:00' },
      // a storm four minutes after the shower stops: two markers wanting
      // one spot
      { type: 'weather', at_min: m.day_end_min - 60, icon: DOT, label: 'Rain stops 19:00' },
      { type: 'weather', at_min: m.day_end_min - 56, icon: DOT, label: 'Storms 20:00' },
    ]);
    return m;
  };
  const OG = 'screen--og screen--md screen--1bit screen--density-1x';
  const fiveLines = fixtures.find((f) => f.name === 'five-lines');
  test('standing up, a sky marker crosses neither the hour strip, nor a rail, nor another marker', () => {
    const allBad = [];
    for (const [metro, v] of [
      [busy.metro, { view: 'full', name: 'og-half-vertical', w: 800, h: 480, slot: { w: 400, h: 480 }, classes: OG }],
      [fiveLines.metro, { view: 'full', name: 'og-half-vertical', w: 800, h: 480, slot: { w: 400, h: 480 }, classes: OG }],
      [busy.metro, byName('x-portrait')],
      [fiveLines.metro, byName('x-portrait')],
    ]) {
      const rep = render(withSky(metro), v);
      if (rep.debug.horizontal) continue;
      const labels = textLabels(rep);
      const sky = labels.filter((l) => (' ' + l.cls + ' ').indexOf(' metro-sky ') >= 0);
      const scale = labels.filter((l) => {
        const c = ' ' + l.cls + ' ';
        return c.indexOf(' metro-hour ') >= 0 || c.indexOf(' metro-axis-note ') >= 0;
      });
      const bad = [];
      for (const m of sky) {
        for (const t of scale) {
          const o = overlap(m, t);
          if (o && o.w > 1 && o.h > 1) bad.push('"' + m.text + '" over the scale\'s "' + t.text + '"');
        }
        for (const p of pathsWhere(rep, 'track').concat(pathsWhere(rep, 'spur'))) {
          if (deepestIntrusion(p.pts, m) > 2) { bad.push('"' + m.text + '" across ' + p.owner + '\'s line'); break; }
        }
      }
      for (let i = 0; i < sky.length; i++) {
        for (let j = i + 1; j < sky.length; j++) {
          const o = overlap(sky[i], sky[j]);
          if (o && o.w > 1 && o.h > 1) bad.push('"' + sky[i].text + '" on "' + sky[j].text + '"');
        }
      }
      if (bad.length) allBad.push(v.name + ' (' + metro.legend.length + ' lines): ' + [...new Set(bad)].join('; '));
    }
    assert(allBad.length === 0, allBad.join(' | '));
  });

  // ---- THE NAME AT BOTH ENDS ---------------------------------------------
  //
  // A transit map letters both termini. This board only lettered the head,
  // so on a wide panel the right-hand end of a line is a couple of feet of
  // paper from the only thing saying whose line it is.
  //
  // The tail is drawn into the gap that happens to be there rather than
  // into a reserved column, so a busy line does not get one -- which is why
  // this asks for "most of them on a roomy board" rather than all. What it
  // is really guarding is the case where a clearance test is too strict and
  // silently suppresses every one: the same shape of failure as the caption
  // tick, which shipped drawing nothing and looked correct doing it.
  //
  // Nothing here checks that a tail name is CLEAR of things. It does not
  // need to: a tail is a .metro-terminus like the head, so "no two text
  // labels overlap" and "a line name keeps clear of its own terminal bar"
  // already cover it -- and both of them caught this when it was wrong.
  test('a line is named at the far end as well, where there is room', () => {
    const rep = layout(busy, ROOMY);
    const names = textLabels(rep).filter((l) =>
      (' ' + l.cls + ' ').indexOf(' metro-terminus ') >= 0);
    const lines = (busy.metro.legend || []).length - ((rep.debug.dropped || []).length);
    assert(names.length > lines, 'no line is named at its far end: '
      + names.length + ' name(s) for ' + lines + ' line(s)');
    // and the far ones really are at the far end
    const mid = rep.canvas.w / 2;
    const tail = names.filter((l) => l.x > mid);
    assert(tail.length >= Math.ceil(lines / 2),
      'only ' + tail.length + ' of ' + lines + ' lines are named past halfway');
  });
};
