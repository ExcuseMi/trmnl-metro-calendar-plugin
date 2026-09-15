'use strict';

// A CROWDED STRETCH IS ONE CAPTION. Back-to-back meetings a quarter of an hour
// apart cannot each have a name beside their own dot: a rail has two sides.
// Three or more of them on one person's line are one caption listing them in
// time order, and every one keeps its own dot. Spread out, they are captioned
// one by one as before.

module.exports = function (test, h) {
  const { layout, fixtures, assert, assertEqual } = h;
  const base = () => JSON.parse(JSON.stringify(fixtures.find((x) => x.name === 'busy-day').metro));

  function day(starts, len) {
    const m = base();
    const who = m.legend[0].key;
    m.events = starts.map((s, i) => ({ type: 'event', title: 'Meeting ' + (i + 1), start_min: s, end_min: s + len, owner: who, co_owners: [] }));
    m.all_day = [];
    return { m, who };
  }

  for (const v of ['x-landscape', 'og-landscape', 'og-half']) {
    test('back-to-back meetings are one list caption, every dot kept: ' + v, () => {
      const { m, who } = day([540, 555, 570, 585, 600], 15);
      const rep = layout({ name: 'crowd-' + v, metro: m }, v);
      const mine = rep.spec.wants.filter((w) => w.line === who && !w.pill);
      assertEqual(mine.length, 1, 'the five meetings are ' + mine.length + ' captions, not one');
      assertEqual((mine[0].members || []).length, 4, 'the other four are not members of the stretch');
      const dots = rep.board.stops.filter((s) => s.kind === 'start' && rep.board.lineByKey(s.line) && (s.line === who || rep.board.lineByKey(s.line).branchOf === who));
      assertEqual(dots.length, 5, 'every meeting does not keep its own dot');
      assertEqual(rep.board.shed, 0, 'the stretch was left unnamed');
      const cap = rep.board.caps.find((c) => c.id === mine[0].id);
      const rows = (cap && cap.form && cap.form.rows) || mine[0].forms[0].rows;
      assert(rows.some((r) => /^9:00\s+Mee/.test(r) || /Meeting 1 \+4/.test(r)), 'the caption does not start with the first meeting and its time: ' + JSON.stringify(rows));
    });
  }

  test('meetings with room between them keep a caption each', () => {
    const { m, who } = day([540, 660, 780], 30);
    const rep = layout({ name: 'spread', metro: m }, 'x-landscape');
    const mine = rep.spec.wants.filter((w) => w.line === who && !w.pill);
    assertEqual(mine.length, 3, 'meetings two hours apart were grouped');
    assert(mine.every((w) => !w.members), 'a spread-out meeting carries members');
  });

  test('a gap of more than a quarter of an hour ends a stretch', () => {
    const { m, who } = day([540, 555, 570, 660, 675, 690], 15);
    const rep = layout({ name: 'two-stretches', metro: m }, 'x-landscape');
    const mine = rep.spec.wants.filter((w) => w.line === who && !w.pill);
    assertEqual(mine.length, 2, 'two stretches an hour apart are ' + mine.length + ' captions');
  });
};
