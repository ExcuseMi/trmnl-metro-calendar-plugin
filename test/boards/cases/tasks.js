'use strict';

// WHAT IS OWED (rule 2q). A task with no time on the board is not a stop.
// A person's OWN waits at the head of their own track, a row under their
// name; one the WHOLE HOUSEHOLD owes is on nobody's track, so it takes a
// row of the platform display above the headlines. A task done today keeps
// its square on the map, filled, and its words struck through.

module.exports = function (test, h) {
  const { build, fixtures, assert } = h;
  const five = fixtures.find((f) => f.name === 'five-lines');
  const KEYS = five.metro.legend.map((l) => l.key);
  const A = KEYS[0], B = KEYS[1];
  const MINE = [
    { title: 'Mow the lawn', owners: [A], done: false, overdue: false },
    { title: 'Homework', owners: [A], done: true, overdue: false },
    { title: 'Library books', owners: [B], done: false, overdue: true },
  ];
  const FAMILY = { title: 'Tidy the shed', owners: KEYS.slice(), done: false, overdue: false };
  const boardWith = (tasks, view) => build(Object.assign({}, five.metro, { tasks: tasks }), view || 'x-landscape');
  const headsOf = (b) => (b.board.fixed || []).filter((f) => f.kind === 'terminus' && f.tasks);

  test('a person\'s own tasks wait under their name, a row each', () => {
    const built = boardWith(MINE);
    const heads = headsOf(built);
    assert(heads.length === 2, heads.length + ' heads carry tasks');
    const mine = heads.find((f) => f.line === A), theirs = heads.find((f) => f.line === B);
    assert(mine && theirs, 'both owners should have one: ' + heads.map((f) => f.line).join(','));
    assert(mine.tasks.map((t) => t.title).join(',') === 'Mow the lawn,Homework', 'A owes: ' + JSON.stringify(mine.tasks.map((t) => t.title)));
    assert(mine.rows >= 3 && theirs.rows >= 2, 'rows booked: ' + mine.rows + ', ' + theirs.rows);
    // drawn at the head: a box each, the done one ticked and struck through
    const stacks = [...built.doc.querySelectorAll('.metro-tasks')];
    assert(stacks.length === 2, stacks.length + ' stacks drawn');
    const boxes = built.doc.querySelectorAll('.metro-task-box');
    assert(boxes.length === 3, boxes.length + ' tick boxes for three owings');
    assert([...boxes].filter((x) => x.querySelector('path')).length === 1, 'the done one is not ticked');
    assert(built.doc.querySelector('.metro-task-done'), 'a done task is not struck through');
    // ...and nothing at the foot, since none of them is the household's
    assert(!built.spec.news, 'a personal task opened the box at the foot');
  });

  test('what the whole household owes takes the foot row instead', () => {
    const built = boardWith(MINE.concat([FAMILY]));
    assert(built.spec.news && built.spec.news.taskRows === 1, 'no foot row for the family task');
    assert(built.spec.news.tasks.map((t) => t.title).join(',') === 'Tidy the shed', 'the foot row: ' + JSON.stringify(built.spec.news.tasks));
    const row = built.doc.querySelector('.metro-task-row');
    assert(row && /Tidy the shed/.test(row.textContent), 'the family task was not drawn at the foot');
    // the personal ones are still at their heads
    assert(headsOf(built).length === 2, 'the personal tasks left their heads');
  });

  test('no tasks, no boxes anywhere', () => {
    const none = build(five.metro, 'x-landscape');
    assert(!headsOf(none).length && !none.doc.querySelector('.metro-tasks'), 'boxes with no tasks');
    assert(!none.doc.querySelector('.metro-task-row'), 'a foot row with no tasks');
  });

  test('a task done today keeps its square on the map, filled', () => {
    const at = five.metro.now_min + 60;
    const ev = { title: 'Bins out', owner: A, start_min: at, end_min: at, todo: true, done: true };
    const open = Object.assign({}, ev, { title: 'Recycling', done: false, start_min: at + 120, end_min: at + 120 });
    const built = build(Object.assign({}, five.metro, { events: five.metro.events.concat([ev, open]) }), 'x-landscape');
    const squares = [...built.doc.querySelectorAll('rect[data-metro-role="stop-start"], rect[data-metro-role="stop-start-edge"]')];
    assert(squares.length >= 2, squares.length + ' task squares');
    const inked = squares.filter((r) => /text-primary/.test(r.style.fill || ''));
    const paper = squares.filter((r) => /canvas-bg/.test(r.style.fill || ''));
    assert(inked.length === 1 && paper.length >= 1, 'filled ' + inked.length + ', hollow ' + paper.length);
  });
};
