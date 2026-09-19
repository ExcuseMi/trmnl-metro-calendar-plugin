'use strict';

// THE PLATFORM DISPLAY AND THE FREE DAY (rules 2i, 2k).
//
// The headlines take a band of ink along the foot of the map, and the map
// gives it up: the rails end above it, the band is as many rows as the
// panel can spare, and a small panel spares one. A board with nothing timed
// on it says so in the middle of the map.
//
// Built rather than laid out from the cache: the band is HTML in the canvas
// and a spec field, neither of which the frozen report carries.

module.exports = function (test, h) {
  const { layout, build, fixtures, assert } = h;
  const five = fixtures.find((f) => f.name === 'five-lines');
  const NEWS = { max: 3, items: [
    { title: 'Nieuwe speeltuin in het Citadelpark opent zaterdag', source: 'Het Nieuwsblad' },
    { title: 'Pyjamadag op vrijdag', source: 'De Wilgenhoek' },
    { title: 'Werken aan de Dampoort: tram 4 rijdt een maand niet', source: 'Het Nieuwsblad' },
    { title: 'Schoolfeest 3 oktober', source: 'De Wilgenhoek' },
  ] };
  const withNews = (news) => Object.assign({}, five.metro, { news: news || NEWS });
  const canvasOf = (built) => built.doc.querySelector('.metro-canvas');

  for (const [v, rows] of [['x-landscape', 3], ['og-landscape', 2], ['og-quadrant', 1]]) {
    test('the headlines take a band at the foot, ' + rows + ' row(s) on ' + v, () => {
      const built = build(withNews(), v);
      const band = built.spec.news;
      assert(band && band.rows === rows, 'rows: ' + (band && band.rows));
      const top = built.view.H - band.h;
      assert(built.spec.cross.c1 <= top + 0.5, 'the map runs under the band: ' + built.spec.cross.c1 + ' > ' + top);
      for (const ln of built.board.lines) {
        for (const pt of ln.pts) assert(pt[1] <= top + 0.5, 'a rail runs into the band at ' + Math.round(pt[1]));
      }
      const el = canvasOf(built).querySelector('.metro-news');
      assert(el, 'no band element');
      assert(Math.abs(parseFloat(el.style.top) - top) <= 2 * built.o.S + 0.5, 'the band element is not at the foot');
      assert(el.querySelectorAll('.metro-news-row').length === rows, 'row elements: ' + el.querySelectorAll('.metro-news-row').length);
    });
  }

  test('the rows are inside the band, source then headline', () => {
    const built = build(withNews(), 'x-landscape');
    const band = canvasOf(built).querySelector('.metro-news');
    const rows = [...band.querySelectorAll('.metro-news-row')];
    assert(rows[0].querySelector('.metro-pill').textContent === 'Het Nieuwsblad', 'the source pill is missing');
    assert(/Citadelpark/.test(rows[0].textContent), 'the headline is missing');
    assert(/Pyjamadag/.test(rows[1].textContent), 'the feeds are not taken in turn');
    assert(band.className.indexOf('inverse') >= 0, 'the band is not ink');
  });

  test('no news, no band, and the map keeps its foot', () => {
    const rep = layout(five, 'x-landscape');
    assert(!rep.spec.news, 'rows reserved for nothing');
    const built = build(five.metro, 'x-landscape');
    assert(!canvasOf(built).querySelector('.metro-news'), 'a band with nothing in it');
    assert(built.spec.cross.c1 >= built.view.H - 12, 'the map lost its foot');
  });

  test('a board standing up draws no band', () => {
    const built = build(withNews(), 'x-portrait');
    assert(!built.spec.news && !canvasOf(built).querySelector('.metro-news'), 'a band across a standing board');
  });

  test('a free day says so, and a busy one does not', () => {
    const say = { quiet_day: 'Nothing planned. Free day!' };
    const quiet = Object.assign({}, five.metro, { events: [], all_day: [], now_min: 590,
      i18n: Object.assign({}, five.metro.i18n || {}, say) });
    const q = build(quiet, 'x-landscape');
    const line = canvasOf(q).querySelector('.metro-quiet');
    assert(line && /Free day/.test(line.textContent), 'the free day is not said');
    // ...but not with a state at somebody's head: "Weekend weg" is a plan
    const away = Object.assign({}, quiet, { all_day: [{ title: 'Weekend away', owners: [five.metro.legend[0].key], days: [0] }] });
    assert(!canvasOf(build(away, 'x-landscape')).querySelector('.metro-quiet'), 'a free day over an all-day state');
    const busy = build(Object.assign({}, five.metro, { i18n: Object.assign({}, five.metro.i18n || {}, say) }), 'x-landscape');
    assert(!canvasOf(busy).querySelector('.metro-quiet'), 'a free day on a busy board');
  });
};
