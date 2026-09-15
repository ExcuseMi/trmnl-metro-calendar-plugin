'use strict';

// A half and a quadrant are slots inside a whole screen, and they are where
// this plugin has the least room and the most to say. Two things were
// spending what room there is on nothing.

module.exports = function (test, h) {
  const { render, fixtures, textLabels, overlap, assert } = h;

  const OG = 'screen--og screen--md screen--1bit screen--density-1x';
  const X = 'screen--v2 screen--lg screen--4bit screen--density-2x';
  // A slot is given in the screen's OWN css px, which for the X is 1040x780
  // (--screen-w/--screen-h), not its 1872x1404 of device pixels.
  const SLOTS = [
    { view: 'full', name: 'og-quadrant', w: 800, h: 480, slot: { w: 400, h: 240 }, classes: OG },
    { view: 'full', name: 'og-half-horizontal', w: 800, h: 480, slot: { w: 800, h: 240 }, classes: OG },
    { view: 'full', name: 'og-half-vertical', w: 800, h: 480, slot: { w: 400, h: 480 }, classes: OG },
  ];
  // The same three slots on an X. They are far bigger in pixels, and that
  // is exactly why they went wrong: every rule about "a small view" was
  // written against a number of pixels, and an X quadrant clears all of
  // them while still being a quarter of a panel.
  const XSLOTS = [
    { view: 'full', name: 'x-quadrant', w: 1872, h: 1404, slot: { w: 520, h: 390 }, classes: X },
    { view: 'full', name: 'x-half-horizontal', w: 1872, h: 1404, slot: { w: 1040, h: 390 }, classes: X },
    { view: 'full', name: 'x-half-vertical', w: 1872, h: 1404, slot: { w: 520, h: 780 }, classes: X },
  ];
  const busy = fixtures.find((f) => f.name === 'busy-day');

  // The header hides the date and the weather at this size for want of
  // room, which leaves a band carrying the mark and the word "Today". On a
  // quadrant that band was a third of the board.
  // A HALF AND A QUADRANT PREFER THE MAP TO THE HEADER, AT ANY SIZE.
  //
  // The rule was a pixel count -- drop the header under 300px of depth --
  // which is true of every slot on an OG panel and of none on an X, where
  // a half-horizontal is 1040x390 and a quadrant 520x390. Both cleared the
  // threshold and kept a band saying "Today" across a view with half the
  // panel's depth to spend. What decides this is not how many pixels the
  // slot has but how much of the panel's DEPTH it got: at half or less,
  // the map wants it more than the word does.
  test('a tiny view spends no height on a header that says nothing', () => {
    for (const v of SLOTS.slice(0, 2).concat(XSLOTS.slice(0, 2))) {
      const rep = render(busy.metro, v);
      // IN THE SAME UNITS. `rep.canvas` is device pixels and a slot is
      // given in the screen's own css px, which on an OG panel are the same
      // number and on an X are 1.8 apart -- so this compared 596 against
      // 390, passed, and said nothing at all about the panel it was added
      // for. The debug dump's own W/H are the css px the engine laid out
      // in, which is what a slot height is.
      const laidH = (rep.debug && rep.debug.H) || rep.canvas.h;
      const Z = (rep.debug && rep.debug.Z) || 1;
      const top = Math.min.apply(null, textLabels(rep).map((l) => l.y).concat([Infinity])) / Z;
      assert(laidH >= v.slot.h * 0.9, v.name + ': the canvas is only '
        + Math.round(laidH) + 'px of a ' + v.slot.h + 'px slot, so something above it is '
        + 'still taking the height');
      assert(top < v.slot.h * 0.2, v.name + ': the topmost thing drawn starts '
        + Math.round(top) + 'px down a ' + v.slot.h + 'px slot');
    }
  });

  // HALF A FAMILY DRAWN COMFORTABLY IS NOT BETTER THAN MOST OF ONE DRAWN TIGHTLY.
  //
  // `fitLines` estimates what a line costs two ways: tightly, which is what
  // a line whose events sit ON it needs, and generously, which adds the
  // clearance a line with a rung hanging off it needs. It used the generous
  // figure whenever somebody was going to be left off anyway, on the
  // argument that an incomplete board should spend its slack on the lines
  // it keeps. That is right on a full panel choosing between four
  // comfortable lines and five crowded ones. In a slot it was choosing
  // between one line and two: a half-horizontal on an 800x480 panel has
  // room for two by the tight figure and was drawing ONE of four people.
  test('a flat slot draws as many people as it can hold, not as few', () => {
    const lines = (rep) => (busy.metro.legend || []).length - ((rep.debug && rep.debug.dropped) || []).length;
    const hh = render(busy.metro, SLOTS[1]);           // og-half-horizontal, 4 lines offered
    assert(lines(hh) >= 2, 'og-half-horizontal drew ' + lines(hh)
      + ' line(s) of 4; the tight estimate says two fit');
  });

  // ...BUT NOT MORE PEOPLE THAN IT CAN WRITE DOWN.
  //
  // The same exemption, applied everywhere, filled the slots it did not
  // belong in. Standing up, every line takes a column the width of its
  // words: a half-vertical kept four lines in 60px columns and wrote
  // "Assemb / ly", "Playgro / up", "Detenti / on" -- eleven captions on top
  // of each other on an 800x480 panel, seventeen on an X. And flat, on a
  // 520px X quadrant, a fourth line's captions had no axis to spread along
  // and landed on each other. A slot that shows fewer people legibly is a
  // better answer than one that shows more of them illegibly.
  test('a slot keeps only the people whose captions it can write legibly', () => {
    const five = fixtures.find((f) => f.name === 'five-lines');
    const overlapsIn = (rep) => {
      const ls = textLabels(rep);
      let n = 0;
      for (let i = 0; i < ls.length; i++) {
        for (let j = i + 1; j < ls.length; j++) {
          const o = overlap(ls[i], ls[j]);
          if (o && o.w > 2 && o.h > 2) n++;
        }
      }
      return n;
    };
    for (const [fixture, v, most] of [
      [busy, SLOTS[2], 5],        // og-half-vertical: was 11
      [five, SLOTS[2], 3],        // og-half-vertical: was 9
      [five, XSLOTS[2], 4],       // x-half-vertical: was 17
      [five, XSLOTS[0], 3],       // x-quadrant, 520px of axis
    ]) {
      const rep = render(fixture.metro, v);
      const n = overlapsIn(rep);
      assert(n <= most, v.name + ' (' + fixture.name + '): ' + n + ' overlapping caption pairs, '
        + 'so it is keeping more people than it can write down');
    }
  });

  // "+3 earlier" and the clock badge are both pinned to the head of the
  // scale. On a quadrant the strip is a few hours wide and they were
  // written straight over each other: "+3 earlier1:32am".
  const EARLY = JSON.parse(JSON.stringify(busy.metro));
  EARLY.day_start_min = 600;             // events before this become "+n earlier"
  EARLY.now_min = 605;                   // and the clock sits at the very head

  test('the clock badge never lands on the overflow note', () => {
    for (const v of SLOTS) {
      const rep = render(EARLY, v);
      const notes = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-axis-note ') >= 0);
      const bad = [];
      for (let i = 0; i < notes.length; i++) {
        for (let j = i + 1; j < notes.length; j++) {
          const o = overlap(notes[i], notes[j]);
          if (o && o.w > 1 && o.h > 1) bad.push('"' + notes[i].text + '" over "' + notes[j].text + '"');
        }
      }
      assert(bad.length === 0, v.name + ': ' + bad.join('; '));
    }
  });

  // And when it does not fit beside the clock, the count is the half worth
  // keeping: "+3" says as much as "+3 earlier" does at the head of a scale.
  test('an overflow note that cannot fit its word keeps its number', () => {
    const rep = render(EARLY, SLOTS[0]);
    const notes = textLabels(rep).filter((l) => (' ' + l.cls + ' ').indexOf(' metro-axis-note ') >= 0);
    const counts = notes.filter((l) => /^\+\d/.test(l.text));
    assert(counts.length > 0, 'a board with events off both ends of the window drew no overflow note at all');
    for (const n of counts) {
      assert(n.x + n.w <= rep.canvas.w + 1 && n.x >= -1,
        'the note "' + n.text + '" runs off the scale');
    }
  });
};
