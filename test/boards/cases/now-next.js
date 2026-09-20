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

const base = require('../../layout/fixtures').find(function (f) { return f.name === 'two-day'; });

module.exports = function (test, h) {
  const { build, assert } = h;

  // Two days, and only the events a case puts on it. `lines` is how many of
  // the fixture's people to keep, so a case can make an event everybody is in.
  function board(nowMin, events, lines) {
    const m = JSON.parse(JSON.stringify(base.metro));
    m.days = m.days.slice(0, 2);
    m.day_start_min = 0;
    m.day_end_min = 2880;
    m.now_min = nowMin;
    m.legend = m.legend.slice(0, lines || 1);
    m.i18n = Object.assign({}, m.i18n || {}, { everyone: 'All' });
    const keys = m.legend.map(function (p) { return p.key; });
    m.events = events.map(function (e) {
      return { type: 'event', title: e.t, start_min: e.a, end_min: e.b, location: null,
               owner: keys[0], co_owners: e.all ? keys.slice(1) : [], side: 'left', hue: 'black',
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

  test('with nothing left today, tomorrow\'s first goes in tomorrow\'s panel, unprefixed', () => {
    // The header over there already says Tomorrow, and "Tomorrow 08:30" under
    // a badge reading Tomorrow says it twice.
    const m = board(NOON, [
      { t: 'Breakfast', a: 8 * 60, b: 9 * 60 },
      { t: 'Swim', a: TOMORROW + 8 * 60 + 30, b: TOMORROW + 9 * 60 },
    ]);
    const built = build(m, 'x-landscape');
    assert(built.doc.querySelectorAll('.metro-daybadge').length > 1,
      'this board was supposed to draw tomorrow a panel of its own');
    const rows = card(m);
    assert(rows.length === 1, 'wanted one row, got ' + JSON.stringify(rows));
    assert(/Swim/.test(rows[0]), 'wanted tomorrow\'s Swim: ' + rows[0]);
    const label = rows[0].split('|')[0];
    assert(!/Tomorrow/i.test(label), 'the word is said twice: ' + rows[0]);
    assert(/\d/.test(label), 'the lead should be the hour: ' + rows[0]);
  });

  test('with no panel for tomorrow, its first event keeps the word', () => {
    // A board whose window stops at midnight draws no second panel, so nothing
    // else on it says which day -- and there the prefix is the whole point.
    const m = board(NOON, [
      { t: 'Breakfast', a: 8 * 60, b: 9 * 60 },
      { t: 'Swim', a: TOMORROW + 8 * 60 + 30, b: TOMORROW + 9 * 60 },
    ]);
    m.days = m.days.slice(0, 1);
    m.day_end_min = TOMORROW;
    const built = build(m, 'x-landscape');
    assert(built.doc.querySelectorAll('.metro-daybadge').length <= 1,
      'this board was supposed to draw one panel');
    const rows = card(m);
    if (!rows.length) return;          // a one-day board may have no room at all
    assert(/Tomorrow/i.test(rows[0].split('|')[0]),
      'with no panel to say it, the row must: ' + rows[0]);
  });

  // WHOSE IT IS, AS A BADGE. It was the name after a middle dot, which is the
  // longest way to say it on the part of the board that runs out of room
  // first: a narrow panel cut "Yoga 10:30 \u00b7 Mia" to "Yoga\u2026" and the
  // reader lost the event AND the person.
  test('the row carries a badge for whose event it is', () => {
    const m = board(NOON, [{ t: 'Yoga', a: 11 * 60, b: 13 * 60 }]);
    const rows = card(m);
    assert(rows.length === 1, 'wanted one row, got ' + JSON.stringify(rows));
    const parts = rows[0].split('|');
    assert(parts.length >= 3, 'no badge on the row: ' + rows[0]);
    const badge = parts[parts.length - 1];
    const who = m.legend[0].name || m.legend[0].key;
    assert(badge.length <= 2 && who.toUpperCase().indexOf(badge.charAt(0).toUpperCase()) === 0,
      'the badge should be ' + who + '\'s initial, got "' + badge + '"');
    assert(!new RegExp(who).test(rows[0]), 'the name is still spelled out: ' + rows[0]);
  });

  test('an event everybody is in gets one badge, not one each', () => {
    // Five badges for a family of five says the same thing five times and
    // crowds out the event. One word says it once -- and it is a word, so it
    // comes from the household's own language.
    const m = board(NOON, [{ t: 'Family Dinner', a: 11 * 60, b: 13 * 60, all: true }], 4);
    const rows = card(m);
    assert(rows.length === 1, 'wanted one row, got ' + JSON.stringify(rows));
    const parts = rows[0].split('|');
    assert(parts[parts.length - 1] === 'All',
      'four people in one event should be one "All" badge: ' + rows[0]);
    assert(parts.length === 3, 'wanted exactly one badge, got ' + JSON.stringify(parts));
  });

  test('an event some of them are in gets a badge each', () => {
    const m = board(NOON, [{ t: 'School Run', a: 11 * 60, b: 13 * 60, all: true }], 4);
    m.events[0].co_owners = m.events[0].co_owners.slice(0, 1);   // two of four
    const rows = card(m);
    const parts = rows[0].split('|');
    assert(parts.length === 4, 'wanted two badges, got ' + JSON.stringify(parts));
    assert(parts[parts.length - 1] !== 'All', 'two of four is not everyone: ' + rows[0]);
  });
};
