'use strict';

// WHEN THE PANEL IS TOO SMALL FOR THE DAY.
//
// A quadrant is four hundred pixels by two hundred and forty. A family of
// five with sixteen events between them does not go in it, and no amount of
// cleverness in the caption solver changes that: the words are a size the
// eye can read or they are not, and there is only so much paper.
//
// So the last decision, and the one that has to be made LAST because it can
// only be made once everything else has been tried: what to leave out.
//
// LINES, NOT CAPTIONS. This is the part that matters and it is the opposite
// of what a caption-level solver does on its own. Left to shed captions, a
// crowded quadrant drops six names from five different people and what is
// left is five lines each missing something, which tells the reader nothing
// they can trust -- they cannot know whether the gaps are quiet or hidden.
// Dropping a whole PERSON is honest: four lines, every one complete, and a
// count saying who is not shown. A reader can act on that.
//
// WHO GOES. The quietest first, because a line with one event loses least by
// being summarised and a line with six is most of the board's information.
// Never below one line: a map of nobody is not a smaller map.

var Bands = require('./bands');
var Day = require('./day');
var B = require('./board');

// What a board is worth to a reader, as one number, worst thing first.
//
// Deliberately NOT the solver's own cost. That cost is for choosing between
// arrangements of the same events; this is for choosing between different
// sets of events, and the currency is different -- a name that cannot be
// read is worth nothing whether it is drawn or not, so an ambiguous caption
// counts the same as a shed one.
function worth(spec, board) {
  // NOT THE ONES DROPPING A PERSON CANNOT FIX. Two line names written over
  // each other says two RAILS arrived at the same level, which is the band
  // search's to answer and is priced there -- see `nameClash` in bands.js.
  // Counted here as well, a full board threw a whole person off to tidy up
  // a crossing that had nothing to do with them.
  var bad = B.check(board).filter(function (f) {
    return f.kind !== 'names' && f.kind !== 'namecut';
  });
  var lost = board.shed + (board.muddle || 0) + bad.length;
  // WHAT WAS LOST, NAMED. A count alone says a board is worth less without
  // saying why, and "why" is the only part anybody can act on.
  var why = bad.map(function (f) { return f.kind + ':' + (f.what || f.by || ''); });
  if (board.shed) why.push('shed:' + board.shed);
  if (board.muddle) why.push('muddle:' + board.muddle);
  return { lost: lost, shown: spec.wants.length - lost, faults: bad.length, why: why };
}

function withoutLines(spec, drop) {
  var keep = {}, lines = [];
  spec.lines.forEach(function (l) {
    if (drop.indexOf(l.key) >= 0) return;
    // EVERYTHING THAT SAYS WHAT THE LINE IS, not just its key and its width.
    // Rebuilt without `style` and `initial`, a board that had dropped anybody
    // came out with every rail solid and every train blank: five identical
    // lines, which is a worse map than the one with somebody missing.
    keep[l.key] = 1;
    lines.push({ key: l.key, width: l.width, name: l.name,
                 style: l.style, initial: l.initial });
  });
  var wants = spec.wants.filter(function (w) {
    if (w.pill) {
      // A convergence survives while anybody still in it is on the board:
      // dinner with four people is still dinner with the two who are left.
      var pl = null;
      (spec.pills || []).forEach(function (p) { if (p.id === w.pill) pl = p; });
      return pl && pl.lines.some(function (k) { return keep[k]; });
    }
    // A tie's name moves to whoever in it is still on the board.
    if (w.tie) return spec.pills.some(function (p) {
      return p.id === w.tie && p.lines.some(function (k) { return keep[k]; });
    });
    if (w.ride) return true;   // with its host, below
    return keep[w.line];
  }).map(function (w) {
    var c = w.clone();
    if (c.tie && !keep[c.line]) {
      spec.pills.forEach(function (p) {
        if (p.id !== c.tie) return;
        p.lines.forEach(function (k) { if (keep[k] && !keep[c.line]) c.line = k; });
      });
    }
    return c;
  });
  // a stack's later parts go where its first went, or with it
  wants = wants.filter(function (w) {
    if (!w.ride) return true;
    var host = wants.filter(function (x) { return x.id === w.ride; })[0];
    if (host) w.line = host.line;
    return !!host;
  });
  var pills = (spec.pills || []).map(function (p) {
    var mine = p.lines.filter(function (k) { return keep[k]; });
    // with where it ends, on the lines still drawn: without `to` a long tie
    // on a board that had shed a line lost its end ticks
    var ends = p.ends ? p.ends.map(function (e) {
      return { to: e.to, open1: e.open1, lines: e.lines.filter(function (k) { return keep[k]; }) };
    }).filter(function (e) { return e.lines.length; }) : null;
    return mine.length ? { id: p.id, a: p.a, a0: p.a0, a1: p.a1, lines: mine, tie: p.tie,
                           to: p.to, ends: ends, open0: p.open0, open1: p.open1, todo: p.todo } : null;
  }).filter(Boolean);
  var out = {};
  Object.keys(spec).forEach(function (k) { out[k] = spec[k]; });
  out.lines = lines; out.wants = wants; out.pills = pills;
  // A shared state goes to whoever in it is still on the board, and is named
  // at THEIR head: the route rows are recomputed from the states kept.
  out.states = (spec.states || []).map(function (st) {
    var owners = st.owners.filter(function (k) { return keep[k]; });
    return owners.length ? { title: st.title, text: st.text, owners: owners, ends: st.ends, head: st.head, timed: st.timed } : null;
  }).filter(Boolean);
  out.fixed = (spec.fixed || []).filter(function (f) {
    return f.kind !== 'terminus' || keep[f.line];
  }).map(function (f) {
    if (f.kind !== 'terminus') return f;
    var route = Day.routeRows(out.states, f.line, spec.oneName)[f.at === spec.axis.a0 ? 0 : 1];
    if ((f.route || null) === route) return f;
    return Object.assign({}, f, { route: route, rows: route ? 2 : 1 });
  });
  // The solver writes its own settings onto a spec; a fresh attempt gets
  // fresh ones rather than inheriting a previous board's.
  ['railGap', 'tieGap', 'markR', 'nameClashPrice', 'shelfClashPrice', 'nameCutPrice', 'minLift', 'leadCap', 'stepShare', 'shelfDepth', 'preRun', 'crowdShelfWorth',
   'muddlePrice', 'branchPrice', 'latePrice', 'bumpPrice', 'bumpNear',
   'straddlePrice', 'driftPrice', 'stepPrice', 'stepWorth', 'formPrice',
   'nameH'].forEach(function (k) { delete out[k]; });
  return out;
}

var EVAL_POOL = 42000;

// Solve, and if the board cannot hold everyone, leave the quietest people
// out until it can.
function fit(spec, opts) {
  opts = opts || {};
  // ONE CLOCK FOR THE WHOLE FIT, ladder included. `timeMs` is how long the
  // caller can wait; the search stops improving when it runs out and the
  // board is drawn with what it has. Unlimited unless asked, so a case
  // solves the same board every time whatever the box it runs on.
  if (opts.timeMs && !opts.deadline) {
    opts = Object.assign({}, opts, { deadline: Date.now() + opts.timeMs });
  }
  // AND A COUNT, WHICH IS THE SAME ON EVERY MACHINE. A clock that runs out
  // makes the board depend on how fast the box drawing it is: two renders
  // of one day on a busy renderer disagreed about where the names went. The
  // search now stops after a fixed number of arrangements priced, shared by
  // the whole ladder, sized above every real board measured (solver/bench.js
  // --real: the most is 2400) so they are never cut; the clock stays as the
  // backstop for a board no household has.
  if (!opts.pool) opts = Object.assign({}, opts, { pool: { used: 0, left: EVAL_POOL } });
  var best = Bands.solve(spec, opts);
  var bestSpec = spec, bestW = worth(spec, best), dropped = [];
  // Nothing dropped yet, so the whole cost is what is unreadable.
  var bestCost = bestW.lost * 4;
  if (!bestW.lost) { best.dropped = []; return best; }

  // Quietest first. Counted from the events that are actually theirs, not
  // from the ones they merely attend.
  var load = {};
  spec.lines.forEach(function (l) { load[l.key] = 0; });
  spec.wants.forEach(function (w) { if (!w.pill && load[w.line] != null) load[w.line]++; });
  var order = spec.lines.map(function (l) { return l.key; })
    .sort(function (a, b) { return load[a] - load[b]; });

  // WHAT IT TRIED AND WHAT EACH ATTEMPT WAS WORTH, kept on the board. A
  // decision this consequential -- somebody is not on the map -- should be
  // answerable afterwards without re-running anything.
  var tried = [{ drop: [], lost: bestW.lost, cost: bestCost, why: bestW.why }];
  // THE ORDER THE RUNGS ARE TRIED IN, AND WHY IT IS NOT ONE UPWARDS.
  //
  // Every rung is a full re-solve and they all share the one clock, so a
  // ladder walked from the top spends its budget on the rungs least likely to
  // win: on a quadrant the answer is usually "leave three out", and the
  // search reached it having already spent most of its second proving that
  // four and five do not go either.
  //
  // `spec.tracks` is what the panel's own size says it can hold (see
  // frameFor), so the rung that drops down to it is the one to try FIRST.
  //
  // TRIED FIRST, NOT INSTEAD. Skipping the rungs above it was the obvious
  // version and it is wrong, and solver/capacity.js is what says so: measured
  // over seven layout boxes, four views and five boards, the cap was below
  // what the unpruned ladder actually kept in 22 cases -- a quadrant that
  // keeps five people with two awkward names is a board `worth` chose on
  // purpose, and a cap that skips that rung overrules it blind. It also saved
  // 4 per cent, which is not a trade worth making in either direction.
  //
  // So nothing is unreachable: the likely rung goes first, its neighbours
  // follow, and the rest are visited outward from it. A board that solves
  // cleanly breaks out early where it used to grind up to the answer, and a
  // board that does not still sees every rung it ever saw.
  var likely = spec.tracks > 0
    ? Math.min(order.length - 2, Math.max(0, order.length - 1 - spec.tracks))
    : 0;
  // NOBODY IS DROPPED FROM A PANEL THAT HAS ROOM FOR THEM. A person left out
  // is for a panel too small for their line, not for a busy day: a couple
  // with fifteen meetings each lost one of the two on the largest panel there
  // is, because eleven names nobody could pin cost more than one person
  // did. Half the household gone is not a tidier board. Names that cannot be
  // placed are shed or left unclear on a board that still shows everyone;
  // rungs only go as far down as the panel's own capacity (`spec.tracks`).
  var keepAtLeast = spec.tracks > 0 ? Math.min(order.length, spec.tracks) : 1;
  var rungs = [];
  for (var r = 0; r < order.length - 1; r++) if (order.length - (r + 1) >= keepAtLeast) rungs.push(r);
  rungs.sort(function (a, b) {
    var da = Math.abs(a - likely), db = Math.abs(b - likely);
    // Nearest the cap first, and on a tie the one dropping FEWER people:
    // between two equally likely rungs the reader keeps the fuller board.
    return da - db || a - b;
  });
  var floorRung = Infinity;
  for (var ri = 0; ri < rungs.length; ri++) {
    // Retired by a clean board with fewer people left out: see below.
    if (rungs[ri] > floorRung) continue;
    var drop = order.slice(0, rungs[ri] + 1);
    var trySpec = withoutLines(spec, drop);
    if (!trySpec.lines.length) break;
    var got = Bands.solve(trySpec, opts);
    var w = worth(trySpec, got);
    // WHAT IS SHOWN HAS TO BE TRUSTWORTHY FIRST, AND PLENTIFUL SECOND.
    //
    // The test was whether MORE names end up readable, and that sets a bar a
    // small panel can rarely clear: dropping a line with four events has to
    // save more than four elsewhere before it counts as progress, so a
    // quadrant kept five people and five unreadable names rather than four
    // people and none.
    //
    // That is the wrong way round, and it is the wrong way round for the
    // reason this whole pass exists: a name a reader cannot pin to a mark is
    // not worth less than a name that is missing, it is worth WORSE than
    // one. A missing person is a gap with a count beside it. A crowded board
    // is five lines that each look complete and are not.
    //
    // So: fewest unreadable first, and only between boards that are equally
    // trustworthy does the one showing more of the day win.
    // WHAT A READER LOSES, IN ONE CURRENCY.
    //
    // Two kinds of loss, and they are not worth the same. A person left out
    // costs their events, and it is HONEST -- there is a gap and a count
    // saying whose. A name the reader cannot pin to a mark costs one name
    // and says nothing: the board looks complete and is not, and it takes
    // the rest of the board's credibility with it.
    //
    // So an unreadable name is worth about three dropped events, and both
    // are counted. Two earlier attempts, both wrong and both instructive:
    // "more names readable" sets a bar a small panel cannot clear, so a
    // quadrant kept five people and five bad names; "fewest unreadable
    // first" clears it too easily, and a FULL board dropped a whole person
    // to fix a single ambiguity.
    // A PERSON IS WORTH MORE THAN THEIR EVENTS. Counted only by the events
    // it removes, dropping somebody with a single entry looked nearly free,
    // and a FULL board threw a person off to tidy up one ambiguous name.
    // What the reader loses is the line: they stop being able to ask "what
    // is Maggie doing today" at all, whether the answer was one thing or
    // six.
    //
    // Weighed against each other on the real demo, at the sizes the panel
    // actually is: an unreadable name at FOUR, an event not shown at one, a
    // person not shown at four.
    //
    // Four rather than three because three made the quadrant an exact tie --
    // five bad names with everyone present against one bad name with two
    // people missing -- and a tie is not a judgement. The tie-break is the
    // difference between the two kinds of loss: a missing person is a gap
    // with a count beside it, and a name the reader cannot place is wrong
    // WITHOUT SAYING SO. Silence is what makes it worse.
    //
    // At four: the quadrant drops two people to make the rest readable, and
    // a full board keeps everybody and wears a single blemish.
    //
    // A PERSON IS WORTH TWO BLEMISHES, NOT ONE.
    //
    // At four each, a quiet line was cheaper than the ambiguity it happened
    // to be near: with the interchanges converging, the full X board found
    // two names it could not pin and threw Maggie -- two events, a whole
    // rail, on a panel with a third of its paper empty -- off to be rid of
    // them. That is not a trade a reader would make. The cost of a line is
    // not the events on it, it is that a person stops being answerable at
    // all, and that is worth more than two names being awkward.
    //
    // At eight the same quadrant still drops the two it should (five bad
    // names at twenty against ten) and the full board keeps everybody.
    var cost = w.lost * 4
      + (spec.wants.length - trySpec.wants.length)
      + drop.length * 8;
    // A TIE IS BROKEN TOWARDS THE HONEST BOARD.
    //
    // The two kinds of loss are weighed against each other above, and on a
    // quadrant they land level often enough to matter: five unreadable names
    // with everybody present came out costing exactly what two people missing
    // cost, and a strict `<` kept the first. That is the wrong half of the
    // tie. A missing person is a gap with a count beside it; a name the
    // reader cannot pin to a mark is wrong WITHOUT SAYING SO, and silence is
    // what makes it worse. Level on price, fewest unreadable wins.
    //
    // NEAR-LEVEL, NOT ONLY LEVEL. The two sides of this trade are counts of
    // different things, and one name either way should not decide it: with
    // everybody present costing 32 and two people left out costing 33, the
    // board kept eight names nobody could read. Within a couple of points
    // the fewest unreadable still wins.
    if (cost < bestCost - 1e-9
        || (cost < bestCost + 2 + 1e-9 && w.lost < bestW.lost)) {
      best = got; bestSpec = trySpec; bestW = w; dropped = drop.slice();
      bestCost = cost;
    }
    tried.push({ drop: drop.slice(), lost: w.lost, cost: cost, why: w.why,
                 events: spec.wants.length - trySpec.wants.length });
    // A CLEAN BOARD ENDS THE SEARCH DOWNWARDS, NOT ALTOGETHER.
    //
    // Walked one rung at a time from the top, the first board with nothing
    // unreadable on it was also the one that had dropped fewest, so stopping
    // there was right. Visiting the likely rung first, it is not: a clean
    // board that leaves three people out says nothing about whether leaving
    // one out would have been clean too, and `cost` charges eight a head.
    // So a clean board at rung k retires every rung BELOW it (more dropped,
    // no better) and the search carries on upwards looking for a fuller one.
    if (!w.lost) floorRung = Math.min(floorRung, rungs[ri]);
  }
  best.dropped = dropped;
  best.tried = tried;
  best.spec = bestSpec;
  return best;
}

module.exports = { fit: fit, worth: worth, withoutLines: withoutLines };
