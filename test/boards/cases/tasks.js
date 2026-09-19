'use strict';

// WHAT IS OWED, ALONG THE FOOT (rule 2q). A task with no time on the board
// is not a stop: it is a tick box in the platform display, above the
// headlines, because what the household owes outranks what the world is
// doing. A task done today keeps its square on the map and has it filled.

module.exports = function (test, h) {
  const { build, fixtures, assert } = h;
  const five = fixtures.find((f) => f.name === 'five-lines');
  const OWNER = five.metro.legend[0].key;
  const TASKS = [
    { title: 'Mow the lawn', owners: [OWNER], done: false, overdue: false },
    { title: 'Library books', owners: [OWNER], done: false, overdue: true },
    { title: 'Homework', owners: [OWNER], done: true, overdue: false },
  ];
  const NEWS = { max: 1, fit: true, items: [
    { title: 'A new playground opens in the park on Saturday', source: 'The Paper' },
    { title: 'Tram 4 is out for a month', source: 'The Paper' },
  ] };
  const canvasOf = (b) => b.doc.querySelector('.metro-canvas');

  test('a task with no time is a tick box along the foot, above the headlines', () => {
    const built = build(Object.assign({}, five.metro, { tasks: TASKS, news: NEWS }), 'x-landscape');
    const box = canvasOf(built).querySelector('.metro-news');
    assert(box, 'no box at the foot');
    assert(built.spec.news.taskRows === 1, 'rows for the tasks: ' + built.spec.news.taskRows);
    const row = box.querySelector('.metro-task-row');
    assert(row, 'no tasks row');
    assert(/Mow the lawn/.test(row.textContent) && /Homework/.test(row.textContent), 'the tasks: ' + row.textContent);
    const boxes = row.querySelectorAll('.metro-task-box');
    assert(boxes.length === TASKS.length, boxes.length + ' tick boxes');
    // the done one is ticked and says so, the others are not
    const ticked = [...boxes].map((b) => !!b.querySelector('path'));
    assert(ticked.join(',') === 'false,false,true', 'ticked: ' + ticked.join(','));
    assert(row.querySelector('.metro-task-done'), 'a done task is not set apart');
    // above the headlines
    const rows = [...box.querySelectorAll('.metro-news-row')];
    assert(rows[0] === row, 'the tasks are not the first row');
    assert(parseFloat(rows[1].style.top) > parseFloat(row.style.top), 'a headline is above the tasks');
  });

  test('no tasks, no row; and the tasks alone still make the box', () => {
    const none = build(Object.assign({}, five.metro, { news: NEWS }), 'x-landscape');
    assert(!canvasOf(none).querySelector('.metro-task-row'), 'a tasks row with no tasks');
    assert(!none.spec.news.taskRows, 'rows reserved for no tasks');
    const only = build(Object.assign({}, five.metro, { tasks: TASKS }), 'x-landscape');
    assert(only.spec.news && only.spec.news.taskRows === 1, 'no box for tasks alone');
    assert(canvasOf(only).querySelector('.metro-task-row'), 'the tasks row was not drawn');
  });

  test('a task done today keeps its square, filled', () => {
    const at = five.metro.now_min + 60;
    const ev = { title: 'Bins out', owner: OWNER, start_min: at, end_min: at, todo: true, done: true };
    const open = Object.assign({}, ev, { title: 'Recycling', done: false, start_min: at + 120, end_min: at + 120 });
    const built = build(Object.assign({}, five.metro, { events: five.metro.events.concat([ev, open]) }), 'x-landscape');
    // (on a shaded line the mark is drawn as a twin under a hairline, and
    // the twin is what carries the fill)
    const squares = [...built.doc.querySelectorAll('rect[data-metro-role="stop-start"], rect[data-metro-role="stop-start-edge"]')];
    assert(squares.length >= 2, squares.length + ' task squares');
    const inked = squares.filter((r) => /text-primary/.test(r.style.fill || ''));
    const paper = squares.filter((r) => /canvas-bg/.test(r.style.fill || ''));
    assert(inked.length === 1 && paper.length >= 1,
      'filled ' + inked.length + ', hollow ' + paper.length + ' of ' + squares.length + ': ' + squares.map((r) => r.style.fill).join(' | '));
  });
};
