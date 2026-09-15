'use strict';

// HOW MUCH OF THE DAY IS ON THE BOARD, AND WHICH DAY IT IS (rules 2b-2h).
//
// The window is the drawing's question: it opens on the step, closes where
// the view runs out or the day does, and crosses into tomorrow only where
// tomorrow is there to draw. A board that crosses a midnight has to draw it
// as one continuous scale: lines run through it, tomorrow's events land at
// tomorrow's times, and no name straddles it.

module.exports = function (test, h) {
  const { layout, fixtures, assert, assertEqual } = h;
  const roll = fixtures.find((f) => f.name === 'rolling-quiet');
  const busy = fixtures.find((f) => f.name === 'busy-day');
  const at = (f, now) => ({ name: f.name + '@' + now, metro: Object.assign({}, f.metro, { now_min: now }) });
  const EVENING = at(roll, 17 * 60);

  // THE TIME IS ON THE BOARD WHATEVER THE HOUR: read at 02:41 a board opened
  // at the morning and drew eight till eight with no clock on it.
  for (const v of ['x-landscape', 'og-landscape', 'og-half-horizontal', 'og-quadrant', 'x-portrait']) {
    test('a board read in the small hours draws the clock: ' + v, () => {
      for (const now of [5, 2 * 60 + 41, 5 * 60 + 30]) {
        // from its own midnight, as transform sends it
        const f = at(busy, now);
        f.metro = Object.assign({}, f.metro, { day_start_min: 0 });
        const rep = layout(f, v);
        const m = rep.spec.metro;
        assert(m.day_start_min <= now && m.day_end_min > now,
          'at ' + now + ' the window ' + m.day_start_min + '-' + m.day_end_min + ' leaves the clock out');
        assert(rep.rects.some((p) => p.role === 'now'), 'at ' + now + ' no now line was drawn');
      }
    });
  }

  test('an evening with little left reaches into tomorrow', () => {
    const rep = layout(EVENING, 'x-landscape');
    assertEqual(rep.spec.cuts.length, 1, 'expected one midnight on the board');
    assert(rep.spec.wants.some((w) => w.text === 'Parkrun'), 'tomorrow\'s parkrun is not on the board');
  });

  test('a busy day read in the morning stays on its own day', () => {
    const rep = layout(busy, 'x-landscape');
    assertEqual(rep.spec.cuts.length, 0, 'a busy day grew a midnight');
    assert(rep.spec.metro.day_start_min >= 6 * 60 - 120,
      'a morning board opened at ' + rep.spec.metro.day_start_min + ', long before its step');
  });

  for (const v of ['x-landscape', 'og-landscape', 'x-portrait']) {
    test('a line runs through midnight rather than stopping at it: ' + v, () => {
      const rep = layout(EVENING, v);
      const cut = rep.spec.cuts[0];
      assert(cut != null, 'no midnight on this board');
      const bad = [];
      for (const ln of rep.board.lines) {
        if (ln.branchOf) continue;
        const a0 = ln.pts[0][0], a1 = ln.pts[ln.pts.length - 1][0];
        if (!(a0 < cut - 10 && a1 > cut + 10)) bad.push(ln.key + ' runs ' + Math.round(a0) + '..' + Math.round(a1));
      }
      assert(!bad.length, 'midnight at ' + Math.round(cut) + ': ' + bad.join('; '));
    });
  }

  test('an event on the second day is drawn at the second day\'s time', () => {
    const rep = layout(EVENING, 'x-landscape');
    const cut = rep.spec.cuts[0], sc = rep.spec.scale;
    const w = rep.spec.wants.find((x) => x.text === 'Parkrun');
    assert(w, 'no parkrun');
    assert(w.a0 > cut, 'the 09:00 of the second day is drawn before midnight');
    assert(Math.abs(w.a0 - sc.at(1440 + 9 * 60)) < 1, 'parkrun is not at 09:00 tomorrow');
  });

  test('no caption is written across a midnight', () => {
    const bad = [];
    for (const f of fixtures.concat([EVENING, at(roll, 21 * 60 + 30)])) {
      for (const v of ['x-landscape', 'og-landscape']) {
        const rep = layout(f, v);
        for (const cut of rep.spec.cuts) {
          for (const cp of rep.board.caps) {
            const b = cp.box();
            if (b.a0 < cut - 1 && b.a1 > cut + 1) bad.push(f.name + '/' + v + ': "' + cp.text + '"');
          }
        }
      }
    }
    assert(!bad.length, bad.slice(0, 5).join('; '));
  });

  // "+N earlier" and "+N more" say the DAY continues past the paper: they
  // count only what is off that edge and still that edge's day (rule 2h).
  test('the overflow notes count only the same day, off their own edge', () => {
    for (const f of fixtures.concat([EVENING])) {
      const rep = layout(f, 'x-landscape');
      const m = rep.spec.metro, lo = m.day_start_min, hi = m.day_end_min;
      const evs = (m.events || []).filter((e) => !e.type || e.type === 'event');
      const early = evs.filter((e) => e.start_min < lo && e.end_min <= lo
        && e.start_min >= Math.floor(lo / 1440) * 1440).length;
      const late = evs.filter((e) => e.start_min >= hi
        && e.start_min < Math.floor(hi / 1440) * 1440 + 1440).length;
      const note = (id) => (rep.spec.fixed.find((x) => x.id === id) || {}).text || null;
      const n = (t) => (t ? parseInt(String(t).replace(/\D+/g, ''), 10) : 0);
      assert(n(note('later')) === late, f.name + ': "+more" says ' + note('later') + ', ' + late + ' are later today');
      assert(n(note('earlier')) <= early, f.name + ': "+earlier" says ' + note('earlier') + ', only ' + early + ' ended before the opening');
    }
  });

  // THE NIGHT RUNS THROUGH MIDNIGHT. Each day's dark was its own two pieces,
  // evening and morning, so a line was drawn at twelve as if the night ended
  // there; and a location whose sun sets after the board's midnight (New York
  // on a Brussels account: sunset 1:04) had its evening left light.
  test('the night is one shade across midnight, with no edge at twelve', () => {
    const B = require('../board');
    const wx = (rise, set) => ({ hi: 20, lo: 10, unit: 'C', condition: 'Clear', milestones: [], rain_chance: 0, sunrise_min: rise, sunset_min: set });
    for (const [set0, rise1] of [[1170, 400], [1504, 757]]) {
      const metro = Object.assign({}, roll.metro, { now_min: 21 * 60,
        days: roll.metro.days.map((d, i) => Object.assign({}, d, { weather: i === 0 ? wx(400, set0) : wx(rise1, set0) })) });
      const built = B.build(metro, 'x-landscape');
      const mid = built.spec.scale.at(1440);
      const edges = [...built.svg.querySelectorAll('line[data-metro-role="night"]')]
        .map((l) => +l.getAttribute('x1')).filter((x) => Math.abs(x - mid) < 2);
      assertEqual(edges.length, 0, 'an edge of the night was drawn at midnight (sunset ' + set0 + ')');
      // dark in the middle of that night, wherever its midnight falls
      const deep = built.spec.scale.at(Math.round((set0 + 1440 + rise1) / 2));
      const across = [...built.svg.querySelectorAll('rect[data-metro-role="night"]')].some((r) => {
        const x = +r.getAttribute('x'), w = +r.getAttribute('width');
        return x < deep && x + w > deep;
      });
      assert(across, 'the middle of the night is not shaded (sunset ' + set0 + ')');
    }
  });
};
