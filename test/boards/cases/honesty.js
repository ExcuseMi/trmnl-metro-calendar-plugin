'use strict';

// THE MAP'S WHOLE JOB IS TO SAY WHEN.
//
// Everything else checks that a drawing is well formed, and all of it passed
// while a label was drawn two hours before the event it named, because the
// branch carrying it ran backwards to find room. These ask whether the
// drawing says what the data says: a name is not before its event, a mark is
// at its event's minute, a rail is as long as its event and not as long as
// its label. Asked in the solver's own units, so there is no scale to read
// back off the hour labels.

module.exports = function (test, h) {
  const { layout, fixtures, assert } = h;
  const VIEWS = ['x-landscape', 'og-landscape'];

  for (const f of fixtures) {
    for (const v of VIEWS) {
      test('no caption is drawn before the event it names: ' + f.name + '/' + v, () => {
        const rep = layout(f, v);
        const want = {};
        rep.spec.wants.forEach((w) => { want[w.id] = w; });
        const bad = [];
        for (const cp of rep.board.caps) {
          const w = want[cp.id];
          if (!w || w.open0) continue;
          const box = cp.box();
          // A name may start a mark or so before its dot (it ranges its rows
          // right, so the time ends where the event begins); wholly before it
          // is the map lying.
          const slack = (rep.spec.markR || 8) * 2;
          const start = w.pill ? rep.board.pills.find((p) => p.id === w.pill).a0 : w.a0;
          if (box.a1 < start - slack) bad.push('"' + cp.text + '" ends ' + Math.round(start - box.a1) + 'px before it starts');
        }
        assert(!bad.length, bad.length + ' caption(s) before their time: ' + bad.slice(0, 4).join('; '));
      });
    }
  }

  // A NAME BESIDE ITS OWN RAIL, within three of its own heights.
  const MAX_ROWS = { };
  const KNOWN_ADRIFT = {};
  for (const f of fixtures) {
    for (const v of VIEWS) {
      const why = KNOWN_ADRIFT[f.name + '/' + v];
      test('every caption sits beside its own rail: ' + f.name + '/' + v, () => {
        const rep = layout(f, v);
        const pr = require('../../../solver/board').pairing(rep.board);
        assert(pr.rows <= (MAX_ROWS[f.name] || 3),
          '"' + pr.what + '" sits ' + pr.rows.toFixed(1) + ' of its own heights from its rail');
      }, why && { known: why });
    }
  }

  // A MARK IS AT ITS EVENT'S MINUTE: a tick where it ends, a dot where it
  // starts or, where a spur had to leave after its minute, where the spur
  // begins -- never before.
  for (const f of fixtures) {
    test('every event is marked at its own minutes: ' + f.name, () => {
      const rep = layout(f, 'x-landscape');
      const bad = [];
      const corner = rep.spec.corner || 13;
      for (const w of rep.spec.wants) {
        if (w.pill || w.allDay || w.tie) continue;
        const mine = rep.board.stops.filter((s) => s.line === (w._rail || w.line));
        if (w.a1 > w.a0 && !w.open1 && !mine.some((s) => s.kind === 'end' && Math.abs(s.a - w.a1) <= 1)) {
          bad.push('"' + w.text + '" has no tick at its end');
        }
        if (!w.open0 && !mine.some((s) => s.kind === 'start' && s.a >= w.a0 - 1 && s.a <= w.a0 + corner * 3)) {
          bad.push('"' + w.text + '" has no dot at its start');
        }
      }
      assert(!bad.length, bad.slice(0, 5).join('; '));
    });
  }

  // A RAIL IS AS LONG AS ITS EVENT: a spur's shelf runs to its event's end,
  // not to the end of its name.
  for (const f of fixtures) {
    test('a spur runs its event\'s span and nothing more: ' + f.name, () => {
      const rep = layout(f, 'x-landscape');
      const bad = [];
      for (const w of rep.spec.wants) {
        if (!w._rail || w._rail === w.line) continue;
        const ln = rep.board.lineByKey(w._rail);
        if (!ln || !ln.pts.length) continue;
        const last = ln.pts[ln.pts.length - 1][0];
        if (Math.abs(last - w.a1) > 1) bad.push('"' + w.text + '" spur ends at ' + Math.round(last) + ' for an event ending at ' + Math.round(w.a1));
      }
      assert(!bad.length, bad.slice(0, 5).join('; '));
    });
  }

  // TIME RUNS FORWARDS at every scale, compressed or not.
  test('the scale is monotonic on every board', () => {
    for (const f of fixtures) {
      for (const v of VIEWS) {
        const sc = layout(f, v).spec.scale;
        const m = layout(f, v).spec.metro;
        let prev = -Infinity;
        for (let t = m.day_start_min; t <= m.day_end_min; t += 5) {
          const a = sc.at(t);
          assert(a >= prev, f.name + '/' + v + ': ' + t + ' is drawn before ' + (t - 5));
          prev = a;
        }
      }
    }
  });
};
