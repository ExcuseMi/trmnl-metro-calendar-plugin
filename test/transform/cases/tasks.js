'use strict';

// WHAT IS OWED (rule 2q). A calendar can carry tasks as well as
// appointments, and they arrive in the same file: Nextcloud Tasks, a
// Todoist project feed, anything that syncs over CalDAV. A task due at a
// time today is a stop like any other; one with no time, and one still
// owed from an earlier day, is carried as a task instead, because the
// board looks forward and a stop in the past is not a thing to do.
// Done today it stays, ticked; done any earlier it is gone.

module.exports = function (test, h) {
  const { runTransform, okText, baseInput, assert } = h;
  const NOW = Date.parse('2026-09-15T08:00:00Z');   // a Tuesday morning, Brussels
  function todo(summary, lines) {
    return ['BEGIN:VTODO', 'UID:' + summary, 'DTSTAMP:20260915T000000Z', 'SUMMARY:' + summary]
      .concat(lines || []).concat(['END:VTODO']).join('\r\n');
  }
  const FEED = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' + [
    todo('Mow the lawn'),                                                   // no due date at all
    todo('Bins out', ['DUE:20260915T170000Z']),                            // due later today
    todo('Library books', ['DUE:20260914T170000Z']),                       // still owed from yesterday
    todo('Homework', ['DUE:20260915T060000Z', 'STATUS:COMPLETED', 'COMPLETED:20260915T063000Z']),
    todo('Old chore', ['DUE:20260914T060000Z', 'STATUS:COMPLETED', 'COMPLETED:20260914T070000Z']),
    todo('Never mind', ['STATUS:CANCELLED']),
  ].join('\r\n') + '\r\nEND:VCALENDAR\r\n';

  async function board(extra) {
    const { run } = runTransform(async () => okText(FEED), NOW);
    const i = baseInput(NOW, Object.assign({ config_json: JSON.stringify({
      lines: [{ name: 'Alex' }],
      calendars: [{ url: 'https://example.com/tasks.ics', name: 'Alex' }],
    }) }, extra || {}));
    i.trmnl.user.time_zone_iana = 'Europe/Brussels';
    return (await run(i)).data;
  }

  test('a task with a time is a stop; one without, and one still owed, are tasks', async () => {
    const d = await board();
    const stops = d.events.filter((e) => e.todo).map((e) => e.title).sort();
    const owed = (d.tasks || []).map((t) => t.title + (t.done ? ' (done)' : '') + (t.overdue ? ' (overdue)' : '')).sort();
    assert(stops.join(',') === 'Bins out,Homework', 'the stops: ' + stops.join(','));
    assert(owed.join(' | ') === 'Library books (overdue) | Mow the lawn', 'what is owed: ' + owed.join(' | '));
    // done today keeps its stop and says so; done yesterday is gone; cancelled never was
    const done = d.events.filter((e) => e.todo && e.done).map((e) => e.title);
    assert(done.join(',') === 'Homework', 'ticked stops: ' + done.join(','));
    assert(!d.events.some((e) => /Old chore|Never mind/.test(e.title)), 'a finished or cancelled task came back');
    assert(!(d.tasks || []).some((t) => /Old chore|Never mind/.test(t.title)), 'a finished or cancelled task is owed');
    // every task knows whose it is
    assert((d.tasks || []).every((t) => (t.owners || []).length === 1), 'a task with no owner: ' + JSON.stringify(d.tasks));
  });

  test('the setting takes them off the board', async () => {
    const d = await board({ tasks_show: 'hide' });
    assert(!(d.tasks || []).length, 'tasks with the setting off: ' + JSON.stringify(d.tasks));
  });
};
