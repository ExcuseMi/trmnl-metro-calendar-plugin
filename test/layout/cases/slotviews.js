'use strict';

// THE OTHER THREE TEMPLATES, WHICH NOTHING HAS EVER RENDERED.
//
// The plugin ships four views -- full, half_horizontal, half_vertical,
// quadrant -- and every case in this suite until now has rendered `full` and
// only `full`. `og-half` looks like an exception and is not: it is the FULL
// template drawn in a half-width slot, which is a different question from
// what `half_vertical.liquid` does.
//
// So three of the four things a panel can actually show have never been
// looked at by anything but a person with a screenshot, which is how a line
// name came to be drawn through its own rail on a half board and stayed
// there. E35 asked for this.
//
// Deliberately a floor rather than a full re-run of the suite at four sizes:
// three fixtures across three views is nine renders, where the whole matrix
// would be sixty and the run is already slow. What it asks is that the view
// draws a board at all, that it stays inside its slot, and that the names on
// it are readable -- which is the set of faults a view nobody renders
// actually collects.
module.exports = function (test, h) {
  const { layout, fixtures, textLabels, overlap, assert } = h;

  const OG = 'screen--og screen--md screen--1bit screen--density-1x';
  // A slot's box, which is what a mashup really hands a view: see pageFor.
  const SLOTS = [
    { name: 'half_horizontal', page: 'half_horizontal', w: 800, h: 480, slot: { w: 800, h: 240 }, classes: OG },
    { name: 'half_vertical', page: 'half_vertical', w: 800, h: 480, slot: { w: 400, h: 480 }, classes: OG },
    { name: 'quadrant', page: 'quadrant', w: 800, h: 480, slot: { w: 400, h: 240 }, classes: OG },
  ];
  const SOME = ['busy-day', 'quiet-day', 'five-lines']
    .map((n) => fixtures.find((f) => f.name === n)).filter(Boolean);

  for (const vp of SLOTS) {
    test('the view draws a board: ' + vp.name, () => {
      const bad = [];
      for (const f of SOME) {
        let rep;
        try { rep = layout(f, vp); } catch (e) { bad.push(f.name + ': ' + e.message); continue; }
        if (!rep.paths.length) bad.push(f.name + ': no lines drawn');
        if (!textLabels(rep).length) bad.push(f.name + ': nothing named');
      }
      assert(bad.length === 0, bad.length + ' board(s) the view cannot draw: ' + bad.join('; '));
    });

    test('nothing is drawn outside the slot: ' + vp.name, () => {
      const bad = [];
      for (const f of SOME) {
        let rep;
        try { rep = layout(f, vp); } catch (e) { continue; }
        for (const l of textLabels(rep)) {
          if (l.x < -1 || l.y < -1 || l.x + l.w > vp.slot.w + 1 || l.y + l.h > vp.slot.h + 1) {
            bad.push(f.name + ': "' + (l.text || '').slice(0, 18) + '"');
          }
        }
      }
      assert(bad.length === 0,
        bad.length + ' label(s) drawn outside the slot: ' + bad.slice(0, 4).join('; '));
    });

    // FOUND BY THIS CASE ON ITS FIRST RUN, which is the argument for the
    // case. `half_vertical` writes "Team Standup" over "Quick Sync" on
    // busy-day and "Desk booking" over "Shift Handover" on five-lines --
    // two names each time, twenty minutes apart on one line, in a 400px
    // column where the caption pass has nowhere to slide them. See E36.
    test('no two names are written on each other: ' + vp.name, () => {
      const bad = [];
      for (const f of SOME) {
        let rep;
        try { rep = layout(f, vp); } catch (e) { continue; }
        const ls = textLabels(rep);
        for (let i = 0; i < ls.length; i++) {
          for (let j = i + 1; j < ls.length; j++) {
            const o = overlap(ls[i], ls[j]);
            if (o && o.w > 2 && o.h > 2) {
              bad.push(f.name + ': "' + (ls[i].text || '').slice(0, 14) + '" x "'
                + (ls[j].text || '').slice(0, 14) + '"');
            }
          }
        }
      }
      assert(bad.length === 0,
        bad.length + ' overlapping name(s): ' + bad.slice(0, 4).join('; '));
    });
  }
};
