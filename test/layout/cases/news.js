'use strict';

// THE ONE ROW OF HEADLINES, CLAMPED (rule 2i). The offline boards suite
// cannot measure a row, so it proves the row's pieces and nothing about
// where it ends. This does: six long headlines strung along one row are
// cut where the row ends, inside the box, the last of them with an
// ellipsis, and none of them wraps.

module.exports = function (test, h) {
  const { layout, fixtures, assert } = h;
  const OG = 'screen--og screen--md screen--1bit screen--density-1x';
  const X = 'screen--v2 screen--lg screen--4bit screen--density-2x';
  const VIEWS = [
    { name: 'og-landscape', w: 800, h: 480, classes: OG },
    { name: 'x-landscape', w: 1872, h: 1404, classes: X },
  ];
  const busy = fixtures.find((f) => f.name === 'busy-day');
  const TITLES = [
    'Nieuwe speeltuin in het Citadelpark opent zaterdag om tien uur',
    'Werken aan de Dampoort: tram 4 rijdt een maand niet, bussen vervangen',
    'Gentse Feesten 2027 krijgen een extra dag en een tweede podium',
    'Stad Gent plant 300 extra bomen langs de Coupure en de Leie',
    'Zwembad Rozebroeken twee weken dicht voor onderhoud van de filters',
    'Bibliotheek De Krook opent zondag ook in de namiddag tot zes uur',
  ];
  const news = (sources) => ({ max: 1, fit: true,
    items: TITLES.map((t, i) => ({ title: t, source: sources[i % sources.length] })) });
  const rowOf = (rep) => rep.labels.find((l) => /metro-news-row/.test(l.cls) && !/metro-banner/.test(l.cls));

  test('one row, clamped: the headlines are cut where the row ends, inside the box', () => {
    for (const v of VIEWS) {
      const rep = layout(busy, v, { news: news(['Het Nieuwsblad']) });
      const row = rowOf(rep);
      assert(row, v.name + ': no headline row');
      assert(row.x + row.w <= rep.canvas.w + 0.5, v.name + ': the row runs out of the box: ' + Math.round(row.x + row.w) + ' > ' + rep.canvas.w);
      // one line: no taller than a label and a half
      const lineH = row.h;
      assert(lineH < 40 * (v.w > 1000 ? 2 : 1), v.name + ': the row wrapped, ' + Math.round(lineH) + 'px tall');
      const shown = TITLES.filter((t) => row.text.indexOf(t) >= 0).length;
      assert(shown >= 1 && shown < TITLES.length, v.name + ': ' + shown + ' whole headlines on the row');
      // the row ends in a cut headline, or the room left is too little for one
      const left = rep.canvas.w - (row.x + row.w);
      assert(/…$/.test(row.text) || left < lineH * 0.6 * 10, v.name + ': the row is not clamped: ends "' + row.text.slice(-20) + '" with ' + Math.round(left) + 'px to spare');
      assert(!/metro-pill/.test(row.cls) && row.text.indexOf('Het Nieuwsblad') < 0, v.name + ': a lone source was named');
    }
  });

  test('only the cut headline gives way: no headline is printed over the one beside it', () => {
    // Giving the row its width made it a flex box narrower than its words,
    // and every piece gave way rather than only the clamped one. These
    // never wrap, so the first headline's words ran across the second's
    // and the two were printed on top of each other, which the row's own
    // box and its run-together text cannot show.
    for (const v of VIEWS) {
      const rep = layout(busy, v, { news: news(['Het Nieuwsblad']) });
      const row = rowOf(rep);
      assert(row, v.name + ': no headline row');
      assert(row.parts && row.parts.length >= 2, v.name + ': the row reported no pieces');
      const cut = row.parts.filter((p) => p.clamp);
      assert(cut.length <= 1, v.name + ': ' + cut.length + ' headlines were told to clamp');
      for (const p of row.parts) {
        if (p.clamp) continue;
        assert(!p.over, v.name + ': "' + p.text.slice(0, 40) + '" is squeezed '
          + Math.round(p.w) + 'px wide and prints over what is beside it');
      }
      // ...and the pieces still range one after another, left to right
      for (let i = 1; i < row.parts.length; i++) {
        const a = row.parts[i - 1], b = row.parts[i];
        assert(b.x >= a.x + a.w - 0.5, v.name + ': piece ' + i + ' starts before the one before it ends');
      }
    }
  });

  test('two sources on the clamped row are named by their pills, in front of their headlines', () => {
    const rep = layout(busy, VIEWS[1], { news: news(['Het Nieuwsblad', 'De Wilgenhoek']) });
    const row = rowOf(rep);
    assert(row, 'no headline row');
    assert(row.x + row.w <= rep.canvas.w + 0.5, 'the row runs out of the box');
    assert(/^Het Nieuwsblad/.test(row.text) && /·\s*De Wilgenhoek/.test(row.text), 'the sources are not in front of their headlines: ' + row.text.slice(0, 80));
  });
};
