'use strict';

// A LINE IS A PERSON: named at its own head, apart from its neighbours, going
// forwards in time, and saying at its head what kind of day it is having
// (rules 3, 4, 33e, 43-44, 54-57).

module.exports = function (test, h) {
  const { layout, fixtures, pathsWhere, assert, assertEqual } = h;
  const FLAT = ['x-landscape', 'og-landscape'];
  const ALL = ['x-landscape', 'og-landscape', 'x-portrait', 'og-half'];
  const faults = (rep, kind) => require('../../../solver/board').check(rep.board).filter((f) => f.kind === kind);

  for (const f of fixtures) {
    for (const v of ALL) {
      test('no line name lands on another line name: ' + f.name + '/' + v, () => {
        const bad = faults(layout(f, v), 'names');
        assert(!bad.length, bad.map((x) => '"' + x.what + '" on "' + x.with + '"').join('; '));
      });
    }
  }

  // The panel used to draw one of these cut: on a seven-line 800x480 board a
  // spur climbed through "Fry" with no tier free for it, and the offline ruler
  // was too narrow to see it. An own-branch cut is priced at four mistakable
  // captions now (bands.js), and the restart that avoids it wins.
  for (const f of fixtures) {
    for (const v of FLAT) {
      test('a line name never lands on somebody else\'s rail: ' + f.name + '/' + v, () => {
        const bad = faults(layout(f, v), 'namecut');
        assert(!bad.length, bad.map((x) => '"' + x.what + '" cut by ' + x.by).join('; '));
      });
    }
  }

  // A LINE'S OWN BRANCH THROUGH ITS NAME IS A CUT NAME. The check exempted
  // every branch of the named line, so a spur climbing straight up through
  // "Bart" at the left edge passed as a clean board. Only the trunk the name
  // stands over is its own.
  test('check() reports a line\'s own branch through its name', () => {
    const BoardM = require('../../../solver/board');
    const b = new BoardM.Board({ axis: { a0: 10, a1: 400 }, cross: { c0: 0, c1: 200 } });
    b.addLine({ key: 'bart', pts: [[10, 100], [400, 100]] });
    b.addLine({ key: 'bart/e0', branchOf: 'bart', pts: [[30, 100], [30, 60], [120, 60]] });
    b.addFixed({ id: 'name:bart', kind: 'terminus', line: 'bart', text: 'Bart', align: 'left', a0: 10, a1: 50, c0: 70, c1: 88 });
    const cut = BoardM.check(b).filter((f) => f.kind === 'namecut');
    assertEqual(cut.map((f) => f.what + ' by ' + f.by), ['Bart by bart/e0']);
  });

  // The rolling example in Polish at half past nine: Field Trip leaves the
  // school day for the right edge a rail's width over the corridor, and the
  // stacked "Bart" was set across it.
  for (const v of ['og-landscape', 'x-landscape']) {
    test('no branch runs through a line name on the rolling example: ' + v, () => {
      const rep = layout({ name: 'rolling-pl', metro: require('../rolling-pl.json') }, v);
      const bad = faults(rep, 'namecut');
      assert(!bad.length, bad.map((x) => '"' + x.what + '" cut by ' + x.by).join('; '));
    });
  }

  // ONCE, AT THE END THE READER COMES TO FIRST. Both ends was for a board
  // read from either side of a room and it cost a column of the day at each
  // edge to say the same word twice; the left-hand one is where the day
  // starts and where the eye lands, and giving the right-hand one back is
  // what pays for the gutter the names sit in now.
  test('every line is named once', () => {
    for (const f of fixtures) {
      const rep = layout(f, 'x-landscape');
      for (const l of rep.spec.lines) {
        const named = rep.board.fixed.filter((x) => x.kind === 'terminus' && x.line === l.key);
        assertEqual(named.length, 1, f.name + ': ' + l.key + ' is named ' + named.length + ' time(s)');
        if (named.length === 1) {
          // (past an edge ring's reach where the board opens on a connector,
          // or stepped clear of a ring and the branch leaving it at the first
          // minute: still the head, a few marks in)
          assert(named[0].a0 <= rep.spec.axis.a0 + Math.max(rep.spec.edgeRing || 0, (rep.spec.markR || 8) * 6) + 1, f.name + ': ' + l.key + ' is named at '
            + Math.round(named[0].a0) + ', past the gutter that ends at ' + Math.round(rep.spec.axis.a0));
        }
      }
    }
  });

  // The slash says the line starts here and the name says whose it is: beside
  // each other, never on top of each other.
  for (const f of ['busy-day', 'five-lines', 'seven-lines']) {
    for (const v of FLAT) {
      test('a line name keeps clear of its own terminal slash: ' + f + '/' + v, () => {
        const rep = layout(fixtures.find((x) => x.name === f), v);
        const names = rep.labels.filter((l) => l.cls === 'metro-terminus');
        const slashes = rep.rects.filter((r) => r.role === 'terminal');
        const need = 2 * rep.debug.S, bad = [];   // layout px: 3.6 SCREEN px was the struck-through name
        for (const n of names) {
          for (const b of slashes) {
            const dx = Math.max(b.x - (n.x + n.w), n.x - (b.x + b.w));
            const dy = Math.max(b.y - (n.y + n.h), n.y - (b.y + b.h));
            if (Math.max(dx, dy) < need) bad.push('"' + n.text + '" ' + Math.max(dx, dy).toFixed(1) + 'px from a slash');
          }
        }
        assert(!bad.length, bad.slice(0, 4).join('; '));
      });
    }
  }

  // "where is the beginning start mark": a slash at the leading edge, or the
  // dots where the line had something before the board opened.
  test('every line starts with a slash or with dots', () => {
    const rep = layout(fixtures.find((x) => x.name === 'five-lines'), 'x-landscape');
    const bad = [];
    for (const ln of rep.board.lines.filter((l) => !l.branchOf)) {
      const marks = rep.rects.filter((r) => (r.role === 'terminal' || r.role === 'terminal-open') && r.owner === ln.key);
      const dots = rep.circles.filter((c) => c.role === 'terminal-more' && c.owner === ln.key);
      // AT THE FIRST MINUTE, wherever that now is: the names took a gutter
      // back (see nameRoom, day.js), so the day no longer starts at the
      // paper's edge and a mark measured against the edge was measured
      // against the wrong thing.
      const x0 = Math.min(...rep.rects.filter((r) => r.owner === ln.key && r.role === 'terminal').map((r) => r.x), Infinity);
      // ...or runs in off the paper's edge, which is what a rail that was
      // already going does now (draw.js headRun): its first point is past the
      // edge, and there is no mark to draw
      const t = pathsWhere(rep, 'track').filter((p) => p.owner === ln.key)[0];
      const offPaper = t && t.pts[0][0] < (rep.spec.axis.edge0 == null ? rep.spec.axis.a0 : rep.spec.axis.edge0) - 1;
      // ...or starts at its roundel, set level at the head
      const levelHead = (rep.spec.fixed || []).some((x) => x.kind === 'terminus' && x.level && x.line === ln.key);
      if (!offPaper && !levelHead && !dots.length && !(marks.length >= 2 && x0 <= rep.spec.axis.a0 + 12)) bad.push(ln.key);
    }
    assert(!bad.length, 'no start mark on ' + bad.join(', '));
  });

  test('a tall canvas runs the lines along its long side', () => {
    const rep = layout(fixtures.find((x) => x.name === 'busy-day'), 'x-portrait');
    assert(rep.debug.horizontal === false, 'a 760x1019 canvas chose the horizontal layout');
    for (const t of pathsWhere(rep, 'track')) {
      const xs = t.pts.map((p) => p[0]), ys = t.pts.map((p) => p[1]);
      assert(Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs),
        t.owner + ' runs across the short side');
    }
  });

  test('seven lines still get a rail apart from their neighbours', () => {
    const seven = fixtures.find((x) => x.name === 'seven-lines');
    for (const v of FLAT) {
      const rep = layout(seven, v);
      const heads = rep.board.lines.filter((l) => !l.branchOf).map((l) => ({ key: l.key, c: l.pts[0][1] }))
        .sort((a, b) => a.c - b.c);
      for (let i = 1; i < heads.length; i++) {
        const gap = heads[i].c - heads[i - 1].c;
        assert(gap > 6 * rep.debug.S, v + ': ' + heads[i - 1].key + ' and ' + heads[i].key + ' start ' + Math.round(gap) + ' apart');
      }
    }
  });

  test('every rail runs forwards in time', () => {
    for (const f of fixtures) {
      for (const ln of layout(f, 'x-landscape').board.lines) {
        for (let i = 1; i < ln.pts.length; i++) {
          assert(ln.pts[i][0] >= ln.pts[i - 1][0] - 0.5, f.name + ': ' + ln.key + ' runs backwards at ' + Math.round(ln.pts[i][0]));
        }
      }
    }
  });

  test('a quiet hour takes less room than a busy one', () => {
    const rep = layout(fixtures.find((x) => x.name === 'busy-day'), 'x-landscape');
    const sc = rep.spec.scale, m = rep.spec.metro;
    const evs = m.events.filter((e) => e.start_min >= m.day_start_min && e.end_min <= m.day_end_min);
    const busyAt = (t) => evs.some((e) => e.start_min <= t + 30 && e.end_min >= t);
    let quiet = null, busy = null;
    for (let t = m.day_start_min; t + 30 <= m.day_end_min; t += 30) {
      const w = sc.at(t + 30) - sc.at(t);
      if (busyAt(t)) busy = Math.max(busy || 0, w); else quiet = Math.min(quiet == null ? Infinity : quiet, w);
    }
    if (quiet == null || busy == null) return;
    assert(quiet < busy, 'the emptiest half hour is ' + Math.round(quiet) + 'px against ' + Math.round(busy) + ' for a busy one');
  });

  // A LINE RUNS FLAT OR STEPS SQUARE (rules 8-13), and a spur takes its
  // lead at 45 degrees or leaves upright: never a squeezed diagonal.
  for (const f of fixtures) {
    test('every rail runs flat, upright or at 45 degrees: ' + f.name, () => {
      const bad = [];
      for (const ln of layout(f, 'x-landscape').board.lines) {
        for (let i = 1; i < ln.pts.length; i++) {
          const da = Math.abs(ln.pts[i][0] - ln.pts[i - 1][0]), dc = Math.abs(ln.pts[i][1] - ln.pts[i - 1][1]);
          if (da < 0.5 || dc < 0.5) continue;
          if (Math.abs(da - dc) > Math.max(1, 0.05 * Math.max(da, dc))) {
            bad.push(ln.key + ' at ' + Math.round(ln.pts[i - 1][0]) + ': ' + Math.round(da) + ' along, ' + Math.round(dc) + ' across');
          }
        }
      }
      assert(!bad.length, bad.slice(0, 4).join('; '));
    });
  }

  // THE CLOCK RUNS FAST ONLY OVER THE NIGHT, AND NOTHING IS DRAWN FOR IT:
  // "we should only time compress between midnight and the earliest event and
  // after the last event till midnight", and "remove the speed lines" from the
  // strip and the rails.
  for (const f of ['rolling-quiet', 'quiet-day', 'busy-day', 'two-day']) {
    test('only the ends of a day run fast, and no speed lines are drawn: ' + f, () => {
      const fx = fixtures.find((x) => x.name === f);
      const rep = layout(fx, 'x-landscape');
      const sc = rep.spec.scale, m = rep.spec.metro, bad = [];
      const days = {};
      (m.events || []).forEach((ev) => {
        if (ev.type && ev.type !== 'event') return;
        if (ev.start_min >= m.day_end_min || (ev.end_min || ev.start_min) <= m.day_start_min) return;
        const d = Math.floor(ev.start_min / 1440), e1 = ev.end_min != null ? ev.end_min : ev.start_min;
        days[d] = days[d] || { first: ev.start_min, last: e1 };
        days[d].first = Math.min(days[d].first, ev.start_min); days[d].last = Math.max(days[d].last, e1);
      });
      for (const sg of (sc.segments || []).filter((x) => x.rate < 1)) {
        const d = days[Math.floor(sg.from / 1440)];
        if (d && sg.from >= d.first && sg.to <= d.last) bad.push(sg.from + '..' + sg.to);
      }
      assert(!bad.length, 'squeezed between two events of the same day: ' + bad.join(', '));
      assertEqual(rep.rects.filter((r) => r.role === 'speed' || r.role === 'express').length, 0, 'speed lines drawn');
    });
  }

  // ---- moments ----------------------------------------------------------
  const moments = fixtures.find((x) => x.name === 'moment-day');
  test('a moment is captioned with one time, not a range', () => {
    for (const v of FLAT) {
      const bad = layout(moments, v).board.caps.filter((c) => /(\d{1,2}[:.]\d{2}\s*(?:am|pm)?)\s*[–-]\s*\1/i.test(c.rows.join(' ')));
      assert(!bad.length, v + ': ' + bad.map((c) => JSON.stringify(c.rows)).join('; '));
    }
  });

  test('a moment gets one mark, not two at the same point', () => {
    for (const v of FLAT) {
      const st = layout(moments, v).board.stops, bad = [];
      st.forEach((s, i) => st.forEach((t, j) => {
        if (j <= i || s.line !== t.line || s.kind === t.kind) return;
        if (Math.hypot(s.a - t.a, s.c - t.c) <= 5) bad.push(s.line + ' at ' + Math.round(s.a));
      }));
      assert(!bad.length, v + ': ' + bad.join('; '));
    }
  });

  test('a board of moments still names every one of them', () => {
    for (const v of FLAT) {
      const text = layout(moments, v).board.caps.map((c) => c.text).join(' | ');
      for (const t of ['Bin Day', 'Family Dinner', 'Standup', 'Swim']) assert(text.indexOf(t) >= 0, v + ': "' + t + '" is missing');
    }
  });

  // ---- all-day states at the head (rules 54-57) ---------------------------
  const oneDay = fixtures.filter((f) => (f.metro.all_day || []).length && !(f.metro.all_day || []).some((a) => a.days));
  for (const f of oneDay) {
    // AT EACH OF ITS OWNERS' HEADS: a shared state is said by every line in
    // it, rather than once with a dashed tie down to the rest -- which, with
    // the names in the legend's column, stood beside the connector already
    // joining the same people and read as a second meeting.
    test('an all-day state is written at each owner\'s head, and nowhere on the axis: ' + f.name, () => {
      const rep = layout(f, 'x-landscape');
      const routes = rep.board.fixed.filter((x) => x.route).map((x) => x.route).join(' | ');
      const drawn = new Set(rep.board.lines.filter((l) => !l.branchOf).map((l) => l.key));
      for (const a of f.metro.all_day) {
        const n = routes.split(a.title).length - 1;
        const want = a.owners.filter((k) => drawn.has(k)).length;
        assertEqual(n, want, '"' + a.title + '" is at ' + n + ' heads');
        assert(!rep.board.caps.some((c) => c.text.indexOf(a.title) >= 0), '"' + a.title + '" is also a caption on the axis');
      }
    });

    test('a line whose day is a slice of something longer ends open at both ends: ' + f.name, () => {
      const rep = layout(f, 'x-landscape');
      const inIt = new Set();
      f.metro.all_day.forEach((a) => a.owners.forEach((k) => inIt.add(k)));
      const open = pathsWhere(rep, 'terminal-open');
      // AN EDGE RING IS AN OPEN END TOO, drawn differently. Where a shared
      // event that was already running when the board opened puts a ring on a
      // rail's first point, an arrow there is drawn straight through the
      // line's own initial, so that end is carried by the ring and the three
      // dots beside it instead. Same statement to the reader, "there was more
      // before this", in the mark the crossing leaves room for.
      const edgeRings = rep.circles.filter((c) => c.role === 'ring-edge');
      const opensFor = (k) => open.filter((p) => p.owner === k).length
        + edgeRings.filter((c) => c.owner === k).length;
      // ONE, AT THE FAR END. The leading end is the paper's edge or the
      // line's roundel now, and neither takes a mark (draw.js headRun,
      // nameLevel): the arrow is drawn where the day runs on past the paper.
      for (const k of inIt) assertEqual(opensFor(k), 1, k + '\'s open ends');
      assert(open.every((p) => inIt.has(p.owner)), 'a line not in any all-day state ends open');
      assertEqual(pathsWhere(rep, 'origin-tie').length, 0, 'a shared state is tied between its heads again');
    });
  }

  test('a holiday opens nobody\'s ends and names nobody\'s head', () => {
    const busy = fixtures.find((x) => x.name === 'busy-day');
    const f = { name: 'busy-christmas', metro: Object.assign({}, busy.metro,
      { holidays: [{ title: 'Christmas Day', day: 0, day_index: 0, day_span: 1, day_label: null }] }) };
    const rep = layout(f, 'x-landscape');
    assertEqual(pathsWhere(rep, 'terminal-open').length, 0, 'open ends');
    assert(!rep.board.fixed.some((x) => x.route), 'a holiday was declared at a head');
    const plain = layout(busy, 'x-landscape');
    assertEqual(rep.paths.length, plain.paths.length, 'the drawing changed for a holiday');
  });

  // BIT DEPTH DECIDES WHAT A LINE IS PAINTED WITH AND NOTHING ELSE: the same
  // rails, marks and names at one bit as at four.
  for (const f of fixtures) {
    test('the board is the same at every bit depth: ' + f.name, () => {
      const at = (bits) => layout(f, { W: 1020, H: 759, bits: bits });
      const shape = (rep) => JSON.stringify({
        paths: rep.paths.filter((p) => p.role === 'track' || p.role === 'spur').map((p) => [p.owner, p.pts.length, Math.round(p.len)]),
        marks: rep.circles.map((c) => [c.role, Math.round(c.x), Math.round(c.y)]),
        caps: rep.board.caps.map((c) => [c.text, Math.round(c.a), Math.round(c.c)]),
      });
      const one = shape(at(1));
      assert(one === shape(at(2)) && one === shape(at(4)), 'the board moved with the bit depth');
    });
  }

  // NO TEXTURE IS MADE OF GAPS (rule 5): on e-ink a dashed line is mostly
  // paper. Every rail is solid ink, and its texture is paper laid over it.
  test('every rail is solid ink, its texture knocked out of it', () => {
    for (const f of fixtures) {
      const rep = layout(f, 'og-landscape');
      const dashed = rep.paths.filter((p) => (p.role === 'track' || p.role === 'spur') && p.dash);
      assert(!dashed.length, f.name + ': ' + dashed.map((p) => p.owner).join(', ') + ' drawn as dashes');
    }
  });
};
