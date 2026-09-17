'use strict';

// A NAME THAT ENDED UP A LONG WAY FROM ITS OWN STOP.
//
// The caption search moves one name at a time, so it settles where no single
// name can better itself -- and a name sitting a long way along the rail from
// its dot is usually there because the paper beside the dot belongs to a
// neighbour: neither move pays on its own, and the pair does. The board that
// ships gets one pass of pair moves (captions.js polish, called from bands.js
// on the winner only), and a move is kept only where the whole board is
// cheaper and no readier to fault.

module.exports = function (test, h) {
  const { layout, fixtures, assert } = h;
  const fix = (n) => fixtures.find((x) => x.name === n);

  function alongOf(rep, text) {
    const w = rep.spec.wants.find((q) => !q.pill && q.text === text);
    if (!w) return null;
    const cp = rep.board.caps.find((c) => c.id === w.id);
    if (!cp) return null;
    const bx = cp.box(), wa1 = w.endAt != null ? w.endAt : w.a1;
    return bx.a1 < w.a0 ? w.a0 - bx.a1 : (bx.a0 > wa1 ? bx.a0 - wa1 : 0);
  }

  // Each of these stood clear of its own event before the pass and over it
  // after, on a board with the same number of names on it.
  //
  // TWO OF THEM CAME BACK, AND WERE LET. Fixing a line's NAME landing in the
  // middle of the board ("Bart end label is in the middle of the page",
  // test/layout/cases/names.js) meant taking the all-day badge off a head
  // whose escape from a branch would otherwise have carried it a quarter of
  // the way across, and a board with one fewer badge on it is a board the
  // caption search solves differently. On these two, one caption comes to
  // rest past its own stop again: School Run by 15px against a 12px bar, Team
  // Standup by 31px.
  //
  // Kept as failures rather than re-baselined, because they ARE failures --
  // the bar is right and the boards are worse for it. What bought them is on
  // the households corpus, which is the closest thing here to real days: 216
  // boards, and three people who were being left off one are now on it
  // (dropped 30 -> 27) with shed, muddle and faults level or better. Three
  // people on the map against two captions adrift on a mashup half is the
  // trade, and by this project's own currency -- a person is worth eight, an
  // unreadable name four -- it is not close.
  //
  // The badge-drop is the crude half of it. What it wants is for the caption
  // search to see the head's own choice rather than be handed it: see the
  // note by the escape in bands.js.
  var KNOWN = {
    'all-day-every-track/og-half/School Run':
      'the badge-drop that keeps a name at its own end (bands.js) reflows this board',
    'three-day-holiday/og-half/Team Standup':
      'the badge-drop that keeps a name at its own end (bands.js) reflows this board',
  };
  [['double-booked', 'og-landscape', 'Design Review'],
   ['double-booked', 'og-half', '1:1 with Priya'],
   ['all-day-every-track', 'og-half', 'School Run'],
   ['three-day-holiday', 'og-half', 'Team Standup'],
   ['seven-lines', 'x-portrait', 'Good News Everyone']].forEach(function (row) {
    test('a name is not left along the rail from its stop: ' + row[2] + ' ' + row[0] + '/' + row[1], () => {
      const rep = layout(fix(row[0]), row[1]);
      const along = alongOf(rep, row[2]);
      assert(along != null, row[2] + ' is not on the board at all');
      const cp = rep.board.caps.find((c) => c.text === row[2] || (c.rows || []).indexOf(row[2]) >= 0);
      const room = Math.max(12, (cp ? cp.h : 20) / 2);
      assert(along <= room, Math.round(along) + 'px from its event, over ' + Math.round(room));
    }, { known: KNOWN[row[0] + '/' + row[1] + '/' + row[2]] });
  });
};
