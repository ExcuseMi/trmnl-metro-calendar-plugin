'use strict';

// THE STANDING VIEWS GET THE SAME BAR AS THE FLAT ONES.
//
// Almost every geometry case runs on x-landscape, and a portrait panel is
// not a landscape one turned on its side: the axis that holds the day
// becomes the tall one, and a caption -- which stays horizontal, because
// text always does -- now takes its width out of the SAME axis the rails
// are spread along. So the two compete for one dimension in a way they
// never do lying down, and nothing was checking it.
//
// What that cost: the caption column was sized from the paper left over
// after both bundles, read through a function that reports each track's
// SOLVED distance from the spine -- and nothing has solved one at that
// point in the layout. Both sides measured zero, the two columns were
// handed the whole cross axis, and the solver was then left to place five
// rails in what remained. It put them in the left 45% of the panel with
// 420px of blank paper beside them and wrote every left-hand rail's
// captions off the edge of the board. Every case in this file passed
// throughout, because every case in this file was landscape.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, textLabels, pathsWhere, overlap,
    deepestIntrusion, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const STANDING = ['x-portrait'];
  const OVERLAP_TOL = 2, INTRUSION_TOL = 4;

  // MEASURED, NOT GUESSED. Standing up, a caption takes its WIDTH out of the
  // same axis the rails are spread along, and two captions on one line
  // twenty minutes apart are taller than the twenty minutes between them.
  // The caption solver slides and ladders them along the axis when the
  // board is flat; standing up it does neither, so they stack on one
  // column and lie across each other and across the next rail along.
  //
  // That is a real defect and it is not this change's to fix: it predates
  // every case in this file, which is exactly why the cases are here. See
  // Standing up, captions are never slid or laddered along the axis.
  const WHY = 'portrait captions are not slid or laddered along the axis: E13';

  // STANDING UP THE WORDS RUN DOWN THE RAIL (draw.js), so a caption's drawn
  // box is the box the solver booked, and the lists of boards these failed
  // on are empty. A new entry needs a reason that is not "portrait".
  const OVERLAP_KNOWN = new Set([]);
  const PIERCE_KNOWN = new Set([]);


  for (const f of fixtures) {
    for (const vname of STANDING) {
      test('no two captions overlap standing up: ' + f.name + '/' + vname, () => {
        const rep = layout(f, byName(vname));
        const ls = textLabels(rep);
        const bad = [];
        for (let i = 0; i < ls.length; i++) {
          for (let j = i + 1; j < ls.length; j++) {
            const o = overlap(ls[i], ls[j]);
            if (o && o.w > OVERLAP_TOL && o.h > OVERLAP_TOL) {
              bad.push('"' + ls[i].text + '" x "' + ls[j].text + '" ('
                + Math.round(o.w) + 'x' + Math.round(o.h) + 'px)');
            }
          }
        }
        assert(bad.length === 0, bad.length + ' overlapping label pair(s): '
          + bad.slice(0, 6).join('; '));
      }, OVERLAP_KNOWN.has(f.name) && { known: WHY });
    }
  }

  for (const f of fixtures) {
    for (const vname of STANDING) {
      test('no rail runs through somebody else\'s caption standing up: '
        + f.name + '/' + vname, () => {
        // Standing up this is the one that catches a caption column wider
        // than the gap between two rails: the words simply lie across the
        // next line along.
        const rep = layout(f, byName(vname));
        const ls = textLabels(rep);
        const lines = pathsWhere(rep, 'track')
          .concat(pathsWhere(rep, 'spur'));
        const owns = {};
        for (const t of f.metro.legend) owns[t.name] = t.key;
        const bad = [];
        for (const box of ls) {
          for (const p of lines) {
            const bare = String(box.text).replace(/\s*\+\d+$/, '');
            if (owns[bare] && owns[bare] === p.owner) continue;
            const d = deepestIntrusion(p.pts, box);
            if (d > INTRUSION_TOL) {
              bad.push('"' + box.text + '" pierced ' + Math.round(d) + 'px by '
                + p.role + ' ' + p.owner);
            }
          }
        }
        assert(bad.length === 0, bad.length + ' label(s) with a line through them: '
          + bad.slice(0, 6).join('; '));
      }, PIERCE_KNOWN.has(f.name) && { known: WHY });
    }
  }

};
