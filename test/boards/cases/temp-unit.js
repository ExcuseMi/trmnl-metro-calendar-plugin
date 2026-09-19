'use strict';

// WHICH SCALE THE HEADER'S NUMBERS ARE ON.
//
// "18° 13°" is two numbers and no unit: fine on a board you set up
// yourself, useless to anybody else looking at it, and the setting that
// decides it is two clicks away in a form nobody opens twice. Said once per
// reading -- on the high where the two stack, after the low where they are on
// one line -- so it covers both numbers without being written twice.

const base = require('../../layout/fixtures').find(function (f) { return f.name === 'two-day'; });

module.exports = function (test, h) {
  const { build, assert } = h;

  function board(unit) {
    const m = JSON.parse(JSON.stringify(base.metro));
    m.header_weather = Object.assign({}, m.header_weather || {}, { hi: 21, lo: 13, unit: unit });
    (m.days || []).forEach(function (d) { if (d.weather) d.weather.unit = unit; });
    return m;
  }

  // Everything the strip says about the weather, drawn and reserved alike,
  // kept APART. Joined into one string, "18°11°Cloudy" reads as a
  // Celsius board to anything looking for a degree and a C -- a fault in the
  // question rather than in the board, and it cost a run to see.
  function words(m, view) {
    const built = build(m, view);
    const drawn = [].slice.call(built.doc.querySelectorAll('.metro-wx-hi, .metro-wx'))
      .map(function (e) { return e.textContent.trim(); });
    const booked = (built.board.fixed || []).map(function (f) { return f.text || ''; });
    return drawn.concat(booked).filter(Boolean);
  }
  // A unit letter is only a unit when no word carries on out of it.
  function has(list, u) {
    const re = new RegExp('°' + u + '(?![A-Za-z])');
    return list.some(function (t) { return re.test(t); });
  }

  for (const view of ['x-landscape', 'og-landscape']) {
    test('the header says which scale its temperatures are on: ' + view, () => {
      const c = words(board('C'), view);
      assert(has(c, 'C'), 'no unit on a Celsius board: ' + JSON.stringify(c));
      assert(!has(c, 'F'), 'a Celsius board said F: ' + JSON.stringify(c));

      const f = words(board('F'), view);
      assert(has(f, 'F'), 'no unit on a Fahrenheit board: ' + JSON.stringify(f));
      assert(!has(f, 'C'), 'a Fahrenheit board said C: ' + JSON.stringify(f));
    });

    test('the unit is said once a reading, not after every number: ' + view, () => {
      // Per reading, not over the board: the high is drawn as its own element
      // AND reserved as a box, so the same number is legitimately in the list
      // twice. What must not happen is one reading saying it twice.
      const twice = words(board('C'), view).filter(function (t) {
        return (t.match(/°C(?![A-Za-z])/g) || []).length > 1;
      });
      assert(!twice.length, 'a reading carries the unit more than once: ' + JSON.stringify(twice));
    });
  }
};
