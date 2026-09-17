'use strict';

// NOW AND NEXT, AND WHICH DAY EACH OF THEM IS ABOUT.
//
// The card beside the date says what is on and what is coming. It asked for
// the next event before `day_end_min`, which is the end of the drawn WINDOW,
// and a rolling board's window runs on into tomorrow -- so a Thursday morning
// with nothing left that day put tomorrow's half past eight swim under
// "Next", beside a "Now" that was today. Two rows about two different days
// with nothing on the board to say so.
//
// The rules, in the words they were asked for:
//   - if there is a Now, only show Next when it is today
//   - with nothing on, Next is still today's
//   - with nothing on AND nothing left today, the first of tomorrow, labelled
//     tomorrow rather than Next

const base = require('../../layout/fixtures').find(function (f) { return f.name === 'three-day'; });

module.exports = function (test, h) {
  const { build, assert } = h;

  // Two days, one person, and only the events a case puts on it.
  function board(nowMin, events) {
    const m = JSON.parse(JSON.stringify(base.metro));
    m.days = m.days.slice(0, 2);
    m.day_start_min = 0;
    m.day_end_min = 2880;
    m.now_min = nowMin;
    m.legend = [m.legend[0]];
    const key = m.legend[0].key;
    m.events = events.map(function (e) {
      return { type: 'event', title: e.t, start_min: e.a, end_min: e.b, location: null,
               owner: key, co_owners: [], side: 'left', hue: 'black',
               track_width: 4, track_style: 'solid', track_offset: -10 };
    });
    m.all_day = []; m.holidays = [];
    return m;
  }
  // The card's rows, as "<label>|<text>".
  function card(m) {
    const built = build(m, 'x-landscape');
    const el = built.doc.querySelector('.metro-nownext');
    if (!el) return [];
    return [].slice.call(el.children).map(function (line) {
      return [].slice.call(line.children).map(function (s) { return s.textContent.trim(); }).join('|');
    });
  }
  const NOON = 12 * 60;
  const TOMORROW = 24 * 60;

  test('with something on and something left today, Now and Next are both today', () => {
    const rows = card(board(NOON, [
      { t: 'Yoga', a: 11 * 60, b: 13 * 60 },
      { t: 'Standup', a: 15 * 60, b: 15 * 60 + 30 },
      { t: 'Swim', a: TOMORROW + 8 * 60, b: TOMORROW + 9 * 60 },
    ]));
    assert(rows.length === 2, 'wanted two rows, got ' + JSON.stringify(rows));
    assert(/Yoga/.test(rows[0]), 'Now should be Yoga: ' + rows[0]);
    assert(/Standup/.test(rows[1]), 'Next should be today\'s Standup, not tomorrow: ' + rows[1]);
  });

  test('with something on and nothing left today, there is no Next at all', () => {
    // The one that was wrong: tomorrow's first event stood under "Next".
    const rows = card(board(NOON, [
      { t: 'Yoga', a: 11 * 60, b: 13 * 60 },
      { t: 'Swim', a: TOMORROW + 8 * 60, b: TOMORROW + 9 * 60 },
    ]));
    assert(rows.length === 1, 'wanted only Now, got ' + JSON.stringify(rows));
    assert(/Yoga/.test(rows[0]), 'the one row should be Now: ' + rows[0]);
    assert(!/Swim/.test(rows.join(' ')), 'tomorrow\'s event is on the card: ' + JSON.stringify(rows));
  });

  test('with nothing on, Next is still today\'s', () => {
    const rows = card(board(NOON, [
      { t: 'Standup', a: 15 * 60, b: 15 * 60 + 30 },
      { t: 'Swim', a: TOMORROW + 8 * 60, b: TOMORROW + 9 * 60 },
    ]));
    assert(rows.length === 1, 'wanted one row, got ' + JSON.stringify(rows));
    assert(/Standup/.test(rows[0]), 'wanted today\'s Standup: ' + rows[0]);
  });

  test('with nothing on and nothing left today, the first of tomorrow is labelled tomorrow', () => {
    const m = board(NOON, [
      { t: 'Breakfast', a: 8 * 60, b: 9 * 60 },
      { t: 'Swim', a: TOMORROW + 8 * 60, b: TOMORROW + 9 * 60 },
    ]);
    const rows = card(m);
    assert(rows.length === 1, 'wanted one row, got ' + JSON.stringify(rows));
    assert(/Swim/.test(rows[0]), 'wanted tomorrow\'s Swim: ' + rows[0]);
    const label = rows[0].split('|')[0];
    assert(label === (m.i18n && m.i18n.tomorrow) || /Tomorrow/i.test(label),
      'it should be labelled tomorrow, not Next: ' + rows[0]);
  });
};
