'use strict';

// ONE EVENT IS ONE EVENT, HOWEVER MANY PEOPLE ARE AT IT (rules 21-27).
//
// Two people at a long thing run their lines together for it; three or more,
// or anything brief, is a tie: one bar across the lines with a ring on each.
// Either way the event is named once, and nobody is drawn in two places.

module.exports = function (test, h) {
  const { layout, fixtures, assert, assertEqual } = h;
  const FLAT = ['x-landscape', 'og-landscape'];

  test('a long event two people share runs their lines together for its length', () => {
    const f = fixtures.find((x) => x.name === 'shared-long-event');
    for (const v of FLAT) {
      const rep = layout(f, v);
      const runs = rep.board.pills.filter((p) => !p.tie);
      assert(runs.length > 0, v + ': no corridor drawn');
      for (const p of runs) {
        const [k0, k1] = p.lines;
        const l0 = rep.board.lineByKey(k0), l1 = rep.board.lineByKey(k1);
        const mid = (p.a0 + p.a1) / 2;
        const inside = Math.abs(l0.cAt(mid) - l1.cAt(mid));
        const outside = Math.abs(l0.pts[l0.pts.length - 1][1] - l1.pts[l1.pts.length - 1][1]);
        assert(inside <= (rep.spec.railGap || 8) * 1.6, v + ': ' + k0 + ' and ' + k1 + ' are ' + Math.round(inside) + ' apart inside the corridor');
        if (!p.open1) assert(inside < outside - 4, v + ': the lines are no closer inside the corridor than after it');
      }
    }
  });

  // BACK TO BACK IS ONE BAR: "hard to tell what even is the second event".
  //
  // Per view, so that the wide board keeps saying so while the small one is
  // known: at the widths the panel really draws, an 800 by 480 board with
  // seven lines on it cannot name both of them and sheds the second.
  const BAR_KNOWN = {
    'og-landscape': 'seven lines on a small board cannot name both halves of the bar at the widths the panel draws',
  };
  FLAT.forEach(function (v) {
  test('shared events back to back are one bar and one branch, each a stop with its own name: ' + v, () => {
    const f = fixtures.find((x) => x.name === 'seven-lines');
    {
      const rep = layout(f, v);
      const early = rep.board.pills.filter((p) => p.tie && p.a < rep.spec.scale.at(10 * 60));
      assert(early.length === 1, v + ': ' + early.length + ' bars for Good News Everyone and Delivery Run');
      const capOf = (t) => rep.board.caps.filter((c) => (c.rows || [c.text]).join(' ').indexOf(t) >= 0)[0];
      const gn = capOf('Good News Everyone'), dr = capOf('Delivery Run');
      assert(gn && dr, v + ': one of the two is not named');
      assert(gn !== dr, v + ': the two are named in one caption');
      // "continue the branch": both on the one branch
      const br = rep.board.lines.filter((l) => l.key === gn.line && l.branchOf)[0];
      assert(br, v + ': Good News Everyone is not on a branch');
      assertEqual(dr.line, gn.line, v + ': Delivery Run is not on the same branch');
      // the branch runs to where Delivery Run ends, with its dot and its tick on it
      const stops = rep.board.stops.filter((s) => s.line === br.key);
      assert(stops.some((s) => s.kind === 'start'), v + ': no dot for Delivery Run on the branch');
      assert(stops.some((s) => s.kind === 'end' && Math.abs(s.a - rep.spec.scale.at(16 * 60)) < 1), v + ': the branch does not end at 16:00');
      assert(stops.filter((s) => s.kind === 'end').length === 2, v + ': not a tick for each of them');
      const end = (early[0].ends || []).filter((e) => e.lines.length === early[0].lines.length)[0];
      assert(end && Math.abs(end.to - rep.spec.scale.at(16 * 60)) < 1, v + ': no end at 16:00 on the lines');
    }
  }, BAR_KNOWN[v] && { known: BAR_KNOWN[v] });
  });

  // SEVERAL THINGS AT ONE STOP ARE A LIST: "merged events/todo should get more
  // space". Where there is room, a name to a row over the time, never one
  // long line cut in the middle of a word; where there is not, two to a row,
  // and where there is less still, the first name and how many more.
  //
  // THE PAIRED ROWS ARE A REAL ANSWER AND NOT A FALLBACK. This case used to
  // ask for the full list or the count and nothing else, and it passed only
  // because the ruler was reading captions a dozen pixels narrow: with the
  // widths the panel really draws, the same board in Chromium sets
  // "Restafval / GF(t)/keukenafval" on one row and "PMD / Papier-karton" on
  // the next. Every name is whole and on its own board, which is what the
  // rule asks for.
  test('merged names are laid out as a list, or the first and a count, never cut mid-word', () => {
    const f = fixtures.find((x) => x.name === 'quiet-day');
    const k = f.metro.legend.map((l) => l.key);
    const parts = ['Restafval', 'GF(t)/keukenafval', 'PMD', 'Papier-karton'];
    const m = JSON.parse(JSON.stringify(f.metro));
    m.events.push({ type: 'event', title: parts.join(' \u00b7 '), parts, start_min: 19 * 60, end_min: 19 * 60, owner: k[0], co_owners: [] });
    const rep = layout({ name: 'quiet-bins', metro: m }, 'x-landscape');
    const cap = rep.board.caps.filter((c) => (c.rows || []).some((r) => /Restafval/.test(r)))[0];
    assert(cap, 'the bins are not named');
    const rows = cap.rows.join(' | ');
    const listed = parts.every((p) => cap.rows.indexOf(p) >= 0);
    // paired: each name whole, two of them to a row, the second run on after
    // the first with the map's own middle dot
    const paired = parts.every((p) => cap.rows.some((r) => r === p || r === '· ' + p));
    const counted = cap.rows.some((r) => /^Restafval \+3$/.test(r));
    assert(listed || paired || counted, 'neither a list, a pair of rows nor a count: ' + rows);
    assert(!/\u2026/.test(rows), 'a name was cut: ' + rows);
  });

  test('a moment several people share hangs its name off the bar, with no branch', () => {
    const f = fixtures.find((x) => x.name === 'quiet-day');
    const k = f.metro.legend.map((l) => l.key);
    const m = JSON.parse(JSON.stringify(f.metro));
    m.events.push({ type: 'event', title: 'Bins Out', start_min: 19 * 60, end_min: 19 * 60, owner: k[0], co_owners: [k[1]] });
    const rep = layout({ name: 'quiet-moment-tie', metro: m }, 'x-landscape');
    const w = rep.spec.wants.filter((x) => x.text === 'Bins Out')[0];
    assert(w && w.pill && !w.tie, 'the moment is not hung off its bar');
    assert(!rep.board.lines.some((l) => l.branchOf && /Bins|\//.test(l.key) && l.ink), 'a branch was drawn for a moment');
  });

  // A SHARED CALENDAR'S LINE IS A LADDER, and the people keep their styles.
  test('a line the config does not name as a person is drawn as a ladder', () => {
    const f = fixtures.find((x) => x.name === 'five-lines');
    const people = f.metro.legend.map((p) => Object.assign({}, p, { configured: true }));
    const base = layout({ name: 'five-lines-named', metro: Object.assign({}, f.metro, { legend: people }) }, 'x-landscape');
    const withFam = { name: 'five-lines-family', metro: Object.assign({}, f.metro, {
      legend: people.concat([{ key: 'fam', name: 'Family', configured: false }]),
      events: f.metro.events.concat([{ type: 'event', title: 'Bin Day', start_min: 600, end_min: 630, owner: 'fam', co_owners: [] }]),
    }) };
    const rep = layout(withFam, 'x-landscape');
    const style = (r, k) => (r.board.lines.filter((l) => l.key === k && !l.branchOf)[0] || {}).style;
    assert(style(rep, 'fam') === 'ladder', 'the family line is ' + style(rep, 'fam'));
    for (const p of people) {
      assert(style(rep, p.key) === style(base, p.key), p.name + ' changed style for a shared line');
      assert(style(rep, p.key) !== 'ladder', p.name + ' is drawn as a shared line');
    }
  });

  // TWO LETTERS THAT DIFFER: "Ma" and "Ma" told Maggie and Marge apart by
  // nothing. The second letter is where the names part.
  test('names sharing a first letter get rings whose letters differ', () => {
    const f = fixtures.find((x) => x.name === 'five-lines');
    const built = h.build(f.metro, 'x-landscape');
    const txt = [...built.svg.querySelectorAll('text[data-metro-role="ring-initial"]')].map((t) => t.textContent);
    assert(txt.includes('Mg') && txt.includes('Mr'), 'rings read ' + [...new Set(txt)].join(', '));
  });

  // A MARK IN THE RAIL'S OWN STYLE: a hollow branch ends in a hollow tick.
  test('a shared event\'s hollow branch ends in a hollow tick', () => {
    const f = fixtures.find((x) => x.name === 'five-lines');
    const built = h.build(f.metro, 'x-landscape');
    const tubes = built.board.lines.filter((l) => l.branchOf && l.ink).map((l) => l.key);
    assert(tubes.length, 'no shared event branch on this board');
    const cores = [...built.svg.querySelectorAll('[data-metro-role="stop-core"]')].map((n) => n.getAttribute('data-metro-owner'));
    for (const k of tubes) assert(cores.includes(k), k + ' ends in a solid tick');
  });

  // A NAME ACROSS ITS OWN PERSON'S BAR: the bar tunnels under the words.
  test('a caption written across a shared event\'s bar has the bar cut under it', () => {
    const BM = require('../../../solver/board');
    let seen = 0;
    const bad = [];
    for (const f of fixtures) {
      for (const v of ['x-landscape', 'og-landscape']) {
        const built = h.build(f.metro, v);
        const b = built.board;
        for (const pl of b.pills.filter((p) => p.tie)) {
          for (const cp of b.caps) {
            const cb = cp.box();
            // across the bar itself, not only the paper round it
            if (!(cb.a0 < pl.a && pl.a < cb.a1 && cb.c0 < pl.c1 && pl.c0 < cb.c1)) continue;
            seen++;
            // the bar is drawn in pieces, and none of them runs through the words
            const X = (a, c) => (built.o.horiz ? [a, c] : [c, a]);
            const mid = X(pl.a, (Math.max(cb.c0, pl.c0) + Math.min(cb.c1, pl.c1)) / 2);
            const through = [...built.svg.querySelectorAll('line[data-metro-role="capsule"][data-metro-owner="' + pl.id + '"]')].some((n) => {
              const y1 = +n.getAttribute('y1'), y2 = +n.getAttribute('y2'), x1 = +n.getAttribute('x1'), x2 = +n.getAttribute('x2');
              return built.o.horiz ? Math.min(y1, y2) < mid[1] && mid[1] < Math.max(y1, y2) : Math.min(x1, x2) < mid[0] && mid[0] < Math.max(x1, x2);
            });
            if (through) bad.push(f.name + '/' + v + ': "' + cp.text + '" on ' + pl.id);
          }
        }
      }
    }
    assert(seen > 0, 'no board writes a name across a bar; the case proves nothing');
    assert(!bad.length, bad.slice(0, 4).join('; '));
  });

  // CROSSINGS, AND WHICH KIND IS NOT A CHOICE: "bridges are used when
  // horizontal lines cross vertical connectors and midnight lines and there
  // are no events on the horizontal line. If there is an event, the vertical
  // connector should tunnel under the line and event line and captions. The
  // midnight line can only tunnel when there's an event at midnight that
  // crosses midnight." A crossing line is never cut or painted over: the bar
  // or the rule is drawn in pieces around it. A bridge wears two square
  // pillars a side, under the deck, the one by the gap the taller, one size
  // everywhere.
  const busy = () => fixtures.find((x) => x.name === 'busy-day');
  function triangle(at) {
    const f = busy(), k = f.metro.legend.map((l) => l.key);
    const m = JSON.parse(JSON.stringify(f.metro));
    m.events.push(
      { type: 'event', title: 'Coffee', start_min: 1050, end_min: 1070, owner: k[1], co_owners: [k[2]] },
      { type: 'event', title: 'Quiz', start_min: 1110, end_min: 1130, owner: k[2], co_owners: [k[3]] },
      { type: 'event', title: 'Walk', start_min: at, end_min: at + 20, owner: k[1], co_owners: [k[3]] });
    return m;
  }
  const roles = (built, role, owner) => [...built.svg.querySelectorAll('[data-metro-role="' + role + '"]')]
    .filter((n) => owner == null || n.getAttribute('data-metro-owner') === owner);
  function polyOf(el) {
    return (el.getAttribute('d') || '').match(/-?\d+(\.\d+)?/g).map(Number)
      .reduce((out, v, i, all) => (i % 2 ? out : out.concat([[v, all[i + 1]]])), []);
  }
  // Does any piece of this bar (or rule) run through screen y at screen x?
  const covers = (nodes, x, y) => nodes.some((n) => Math.abs(+n.getAttribute('x1') - x) < 6
    && Math.min(+n.getAttribute('y1'), +n.getAttribute('y2')) < y && y < Math.max(+n.getAttribute('y1'), +n.getAttribute('y2')));
  function walk(at) {
    const built = h.build(triangle(at), 'x-landscape');
    const pl = built.board.pills.filter((p) => p.tie && p.lines.length === 2
      && Math.abs(p.a - built.spec.scale.at(at)) < 1)[0];
    const sam = built.board.lineByKey('sam');
    return { built, pl, x: pl.a, y: sam.cAt(pl.a) };
  }

  test('a line with nothing on it where a bar crosses is a bridge: the bar in pieces, two square pillars a side', () => {
    const { built, pl, x, y } = walk(13 * 60);
    assert(!covers(roles(built, 'capsule', pl.id), x, y), 'the bar runs through Sam\'s rail');
    assert(roles(built, 'capsule', pl.id).length >= 2, 'the bar is not in pieces');
    const piers = roles(built, 'guardrail', 'sam').map(polyOf).filter((q) => q.some((v) => Math.abs(v[0] - x) < 30));
    assertEqual(piers.length, 4, 'pillars beside the gap');
    assertEqual(piers.map((q) => Math.sign(q[0][0] - x)).sort(), [-1, -1, 1, 1], 'the pillars are not two each side');
    const W = +roles(built, 'track', 'sam')[0].getAttribute('stroke-width');
    for (const q of piers) {
      assert(q.every((v) => v[1] >= y - 0.5), 'a pillar reaches above the deck');
      assert(Math.abs(q[2][1] - q[3][1]) < 0.5, 'a pillar is not square-cut');
      assert(Math.abs(Math.abs(q[1][0] - q[0][0]) - W * 0.5) < 0.6, 'a pillar is not half the deck wide');
    }
    const depth = (q) => Math.max(...q.map((v) => v[1]));
    for (const sd of [-1, 1]) {
      const side = piers.filter((q) => Math.sign(q[0][0] - x) === sd).sort((p, q) => Math.abs(p[0][0] - x) - Math.abs(q[0][0] - x));
      assert(depth(side[0]) > depth(side[1]), 'the pillar by the gap is not the taller');
    }
    assertEqual(roles(built, 'portal', pl.id).filter((n) => Math.abs(+n.getAttribute('y1') - y) < 20).length, 0, 'a bridge has tunnel mouths');
  });

  test('a line with an event on it where a bar crosses has the bar go under it: a tunnel with mouths, no pillars', () => {
    const { built, pl, x, y } = walk(1235);
    assert(!covers(roles(built, 'capsule', pl.id), x, y), 'the bar runs through Sam\'s rail');
    assertEqual(roles(built, 'guardrail', 'sam').length, 0, 'pillars on a line with an event on it');
    assert(roles(built, 'portal', pl.id).length > 0, 'no tunnel mouths');
  });

  for (const name of ['rolling-quiet', 'three-day']) {
    test('every line crossing the midnight with nothing on it bridges it, the rule in pieces around it: ' + name, () => {
      const f = fixtures.find((x) => x.name === name);
      const built = h.build(Object.assign({}, f.metro, { now_min: 17 * 60 }), 'x-landscape');
      const cut = built.spec.cuts && built.spec.cuts[0];
      assert(cut != null, 'no midnight on this board');
      const rules = roles(built, 'midnight').filter((n) => n.tagName === 'line');
      let crossing = 0;
      for (const ln of built.board.lines.filter((l) => !l.branchOf)) {
        if (!(ln.pts[0][0] < cut - 12 && ln.pts[ln.pts.length - 1][0] > cut + 12)) continue;
        crossing++;
        const y = ln.cAt(cut);
        assert(!rules.some((n) => Math.min(+n.getAttribute('y1'), +n.getAttribute('y2')) < y && y < Math.max(+n.getAttribute('y1'), +n.getAttribute('y2'))
          && Math.abs(+n.getAttribute('x1') - cut) < 6), ln.key + ': the rule runs through the rail');
        assertEqual(roles(built, 'guardrail', ln.key).length, 4, ln.key + ': pillars at the midnight');
      }
      assert(crossing > 0, 'no line crosses the midnight');
    });
  }

  test('every line style is drawn at one width, so every bridge is one size', () => {
    const f = fixtures.find((x) => x.name === 'seven-lines');
    const built = h.build(f.metro, 'x-landscape');
    const widths = [...new Set(roles(built, 'track').map((n) => (+n.getAttribute('stroke-width')).toFixed(2)))];
    assertEqual(widths.length, 1, 'trunks drawn at ' + widths.join(', '));
    const b3 = fixtures.find((x) => x.name === 'three-day');
    const bb = h.build(Object.assign({}, b3.metro, { now_min: 17 * 60 }), 'x-landscape');
    const sizes = [...new Set(roles(bb, 'guardrail').map(polyOf).map((q) => Math.abs(q[1][0] - q[0][0]).toFixed(1)))];
    assertEqual(sizes.length, 1, 'pillars of widths ' + sizes.join(', '));
  });

  test('an event running across the midnight has the midnight tunnel under it: no pillars on that line', () => {
    const f = fixtures.find((x) => x.name === 'rolling-quiet');
    const m = Object.assign(JSON.parse(JSON.stringify(f.metro)), { now_min: 17 * 60 });
    const who = m.legend[0].key;
    m.events.push({ type: 'event', title: 'Late Shift', start_min: 23 * 60, end_min: 25 * 60, owner: who, co_owners: [] });
    const built = h.build(m, 'x-landscape');
    assertEqual(roles(built, 'guardrail', who).length, 0, 'pillars under a line whose event crosses the midnight');
  });

  test('nothing is painted over a crossing line', () => {
    for (const f of fixtures) {
      const built = h.build(f.metro, 'x-landscape');
      for (const r of ['tunnel', 'bridge', 'over']) assertEqual(roles(built, r).length, 0, f.name + ': a ' + r + ' piece was painted');
    }
  });

  for (const f of fixtures) {
    test('a tie is one bar across the lines in it, with a ring on each: ' + f.name, () => {
      const rep = layout(f, 'x-landscape');
      const bad = [];
      for (const p of rep.board.pills.filter((q) => q.tie && !q.open0)) {
        const cs = p.lines.map((k) => rep.board.lineByKey(k)).filter(Boolean).map((l) => l.cAt(p.a));
        if (Math.abs(Math.min(...cs) - p.c0) > 1 || Math.abs(Math.max(...cs) - p.c1) > 1) {
          bad.push(p.id + ' spans ' + Math.round(p.c0) + '..' + Math.round(p.c1) + ' for lines at ' + cs.map(Math.round));
        }
        const rings = rep.circles.filter((c) => c.role === 'ring');
        for (const k of p.lines) {
          if (!rings.some((c) => c.owner === k)) bad.push(p.id + ': no ring on ' + k);
        }
      }
      assert(!bad.length, bad.slice(0, 4).join('; '));
    });
  }

  test('a shared event is named once', () => {
    for (const f of fixtures) {
      for (const v of FLAT) {
        const rep = layout(f, v);
        const shared = rep.spec.metro.events.filter((e) => (e.co_owners || []).length
          && e.start_min >= rep.spec.metro.day_start_min && e.start_min < rep.spec.metro.day_end_min);
        for (const e of shared) {
          const n = rep.board.caps.filter((c) => c.text === e.title).length;
          const same = shared.filter((x) => x.title === e.title).length;
          assert(n <= same, f.name + '/' + v + ': "' + e.title + '" is named ' + n + ' times');
        }
      }
    }
  });

  // NOBODY IS IN TWO PLACES AT ONCE (rule 26a): a member with something of
  // their own during a corridor is not at the corridor's level while it lasts.
  for (const f of fixtures) {
    test('nobody is held in a corridor during their own event: ' + f.name, () => {
      const rep = layout(f, 'x-landscape');
      const bad = [];
      for (const p of rep.board.pills.filter((q) => !q.tie)) {
        const level = (p.c0 + p.c1) / 2;
        for (const w of rep.spec.wants) {
          if (w.pill || w.tie || w.allDay || p.lines.indexOf(w.line) < 0) continue;
          if (w.a1 - w.a0 >= (p.a1 - p.a0) * 0.9) continue;       // a state is not a place (rule 27)
          const a = (Math.max(w.a0, p.a0) + Math.min(w.a1, p.a1)) / 2;
          if (!(a > p.a0 + 1 && a < p.a1 - 1)) continue;
          const rail = rep.board.lineByKey(w._rail || w.line);
          const c = rail && rail.cAt(a);
          if (c != null && Math.abs(c - level) <= (p.c1 - p.c0) / 2 + 1) bad.push('"' + w.text + '" is marked inside ' + p.id);
        }
      }
      assert(!bad.length, bad.join('; '));
    });
  }

  // Leaving an interchange, two rails dropping on one column read as ONE line
  // with a gap in it.
  const COLUMN_KNOWN = {};
  for (const f of fixtures) {
    test('no two lines turn on the same column: ' + f.name, () => {
      const rep = layout(f, 'x-landscape');
      const cols = {};
      for (const ln of rep.board.lines) {
        if (ln.branchOf) continue;
        for (let i = 1; i < ln.pts.length; i++) {
          const p = ln.pts[i - 1], q = ln.pts[i];
          if (Math.abs(q[0] - p[0]) < 0.5 && Math.abs(q[1] - p[1]) > 10) (cols[ln.key] = cols[ln.key] || []).push(q[0]);
        }
      }
      const keys = Object.keys(cols), bad = [];
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          for (const a of cols[keys[i]]) for (const b of cols[keys[j]]) {
            if (Math.abs(a - b) < 3 * rep.debug.S) bad.push(keys[i] + ' and ' + keys[j] + ' at ' + Math.round(a));
          }
        }
      }
      assert(!bad.length, bad.slice(0, 4).join('; '));
    }, COLUMN_KNOWN[f.name] && { known: COLUMN_KNOWN[f.name] });
  }

  // SOMETHING OF ONE'S OWN DURING A SHARED RUN IS DRAWN INSIDE IT, AFTER IT
  // STARTS: Lisa's assembly at nine during the school day was drawn on her
  // own row, before the diamond -- "Assembly is before school day but that's
  // incorrect". Every rail an event rides leaves the corridor after the
  // member is in it.
  const simpsons = (now) => ({ name: 'simpsons@' + now, metro: Object.assign({}, require('../simpsons.json'), { now_min: now }) });
  for (const now of [20 * 60 + 41, 14 * 60 + 10]) {
    test('an event inside a shared run leaves it after the member has joined: simpsons at ' + now, () => {
      for (const v of FLAT) {
        const rep = layout(simpsons(now), v), bad = [];
        for (const p of rep.board.pills.filter((q) => !q.tie)) {
          for (const w of rep.spec.wants) {
            if (w.pill || w.tie || w.allDay || p.lines.indexOf(w.line) < 0) continue;
            if (!(w.a0 > p.a0 + 1 && w.a1 < p.a1 - 1)) continue;
            // After the DIAMOND, which stands where the last member arrives:
            // one member joining early is not the group having started.
            const ins = (p.joins || []).map((x) => x.in_).filter((x) => x != null);
            const rail = rep.board.lineByKey(w._rail || w.line);
            if (!ins.length || !rail || !rail.pts.length) continue;
            const diamond = Math.max(...ins);
            if (rail.pts[0][0] < diamond - 1) bad.push('"' + w.text + '" leaves at ' + Math.round(rail.pts[0][0]) + ', the group is together at ' + Math.round(diamond));
          }
        }
        assert(!bad.length, v + ': ' + bad.join('; '));
      }
    });
  }
};
