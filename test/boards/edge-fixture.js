'use strict';

// A BOARD WHOSE SHARED EVENT WAS ALREADY RUNNING WHEN THE PAPER OPENED.
//
// None of the shipped fixtures grows one of these with an END: all three that
// have a tie at the board's first minute record no end for it, so the shelf
// that hangs off the connector is never drawn on any of them, and a test
// written against them proves nothing about it. Found the hard way, by putting
// a known bug back and watching the suite stay green.
//
// So the shape is built: a long event shared by three people that began before
// the window and finishes inside it. Lives here rather than in one case file
// because more than one case needs it and two copies would drift.

module.exports = function edgeFixture(fixtures) {
  const base = fixtures.find((x) => x.name === 'busy-day');
  if (!base) throw new Error('edge-fixture: busy-day is gone, so this needs a new base');
  return {
    name: 'run-already-going',
    metro: Object.assign({}, base.metro, {
      events: [{ type: 'event', title: 'Delivery Run',
                 start_min: base.metro.day_start_min - 180,
                 end_min: Math.round((base.metro.day_start_min + base.metro.day_end_min) / 2),
                 location: null, owner: 'kids', co_owners: ['sam', 'alex'],
                 side: 'right', hue: 'purple-40', track_width: 3,
                 track_style: 'solid', track_offset: 30 }]
        .concat(base.metro.events || []),
    }),
  };
};
