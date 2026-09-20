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

  // (five lines on a quadrant have no row to spare: the tracks come first)
  for (const [v, rows] of [['x-landscape', 3], ['og-landscape', 2], ['og-quadrant', 0]]) {
    test('the headlines take a band at the foot, ' + rows + ' row(s) on ' + v, () => {
      const built = build(withNews(), v);
      const band = built.spec.news;
      if (!rows) { assert(!band, 'a box on a panel with no row to spare: ' + JSON.stringify(band)); return; }
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
    // a newspaper in front of every headline row, before its pill
    rows.forEach(function (r, i) {
      var ic = r.firstChild;
      assert(ic && /metro-news-icon/.test(ic.getAttribute('class') || ''), 'row ' + i + ' does not start with the news icon');
    });
    assert(/Citadelpark/.test(rows[0].textContent), 'the headline is missing');
    assert(/Pyjamadag/.test(rows[1].textContent), 'the feeds are not taken in turn');
    assert(band.className.indexOf('inverse') >= 0, 'the band is not ink');
  });

  test('a weather alert is the first row of the box, above the headlines', () => {
    const RAIN = { kind: 'rain', icon: 'https://trmnl.com/images/plugins/weather/wi-rain.svg',
      text: 'Rain from 14:00 until 17:00 (80%)',
      parts: [{ t: 'Rain', s: 'b' }, { t: ' from ', s: 'q' }, { t: '14:00', s: '' }, { t: ' until ', s: 'q' }, { t: '17:00', s: '' }, { t: ' (80%)', s: 'q' }] };
    const built = build(Object.assign(withNews(), { service_alert: RAIN }), 'x-landscape');
    assert(built.spec.news && built.spec.news.alertRows === 1 && built.spec.news.rows === 3, 'rows: ' + JSON.stringify(built.spec.news && [built.spec.news.alertRows, built.spec.news.rows]));
    // ...IN A BOX OF ITS OWN, above the headlines' box ("separate boxes at
    // the bottom per type")
    const boxes = [...canvasOf(built).querySelectorAll('.metro-news')];
    const alertBox = boxes.find((b) => /metro-news--alert/.test(b.className));
    const newsBox = boxes.find((b) => /metro-news--news/.test(b.className));
    assert(alertBox && newsBox, 'boxes: ' + boxes.map((b) => b.className).join(' | '));
    assert(parseFloat(alertBox.style.top) < parseFloat(newsBox.style.top), 'the alert is not above the headlines');
    const rows = [...alertBox.querySelectorAll('.metro-news-row')];
    assert(rows.length === 1, rows.length + ' rows in the alert box');
    assert(rows[0].className.indexOf('metro-banner') >= 0 && rows[0].getAttribute('data-metro-alert') === 'rain', 'the alert is not the box\'s row');
    assert(rows[0].querySelector('.metro-banner-text').textContent === RAIN.text, 'the alert text is not whole');
    assert(rows[0].querySelector('.metro-banner-icon'), 'the alert has no icon');
    assert(newsBox.querySelectorAll('.metro-news-row').length === 3, 'headline rows: ' + newsBox.querySelectorAll('.metro-news-row').length);
    // ...and the alert alone still makes a box, with no feeds at all
    const only = build(Object.assign({}, five.metro, { service_alert: RAIN }), 'x-landscape');
    assert(only.spec.news && only.spec.news.alertRows === 1 && only.spec.news.rows === 0, 'no box for an alert without news');
    assert(canvasOf(only).querySelector('.metro-news .metro-banner'), 'the alert was not drawn');
  });

  test('the tracks come first: the headlines give up rows on a crowded panel', () => {
    const seven = fixtures.find((f) => f.name === 'seven-lines');
    const crowded = build(Object.assign({}, seven.metro, { news: NEWS }), 'og-landscape');
    const roomy = build(withNews(), 'og-landscape');
    const rowsOf = (b) => (b.spec.news ? b.spec.news.rows : 0);
    assert(rowsOf(roomy) === 2, 'five lines on an OG should hold two rows, got ' + rowsOf(roomy));
    assert(rowsOf(crowded) < rowsOf(roomy), 'seven lines on an OG kept ' + rowsOf(crowded) + ' row(s), as many as five');
    // every line keeps at least three names' depth of map
    const nameH = crowded.spec.nameH || 18;
    const per = (crowded.spec.cross.c1 - crowded.spec.cross.c0) / seven.metro.legend.length;
    assert(per >= nameH * 2.4 - 0.5 || rowsOf(crowded) === 0, 'the map is ' + Math.round(per) + 'px a line under ' + rowsOf(crowded) + ' row(s)');
  });

  test('one row, as many as fit: the headlines string along a single row with their sources', () => {
    const built = build(withNews(Object.assign({}, NEWS, { max: 1, fit: true })), 'x-landscape');
    assert(built.spec.news && built.spec.news.rows === 1 && built.spec.news.fit, 'rows: ' + JSON.stringify(built.spec.news && [built.spec.news.rows, built.spec.news.fit]));
    const rows = [...canvasOf(built).querySelector('.metro-news').querySelectorAll('.metro-news-row')];
    assert(rows.length === 1, rows.length + ' rows');
    // (the offline ruler measures nothing, so every headline fits)
    const pills = rows[0].querySelectorAll('.metro-pill');
    assert(pills.length === NEWS.items.length, pills.length + ' sources on the row');
    assert(/Citadelpark.*\u00b7.*Pyjamadag/.test(rows[0].textContent), 'the headlines are not separated by a dot');
    assert(pills[0].className.indexOf('metro-pill--quiet') < 0, 'the source pill is not solid');
  });

  test('one source is not named: the pills only say which paper when there are two', () => {
    const one = { max: 1, fit: true, items: NEWS.items.map((it) => Object.assign({}, it, { source: 'Het Nieuwsblad' })) };
    const built = build(withNews(one), 'x-landscape');
    const row = canvasOf(built).querySelector('.metro-news .metro-news-row');
    assert(row && !row.querySelector('.metro-pill'), 'a lone source was named on every headline');
    assert(row.querySelector('.metro-news-icon'), 'the news icon is missing');
    assert(/Citadelpark/.test(row.textContent), 'the headline is missing');
  });

  test('no news, no band, and the map keeps its foot', () => {
    const rep = layout(five, 'x-landscape');
    assert(!rep.spec.news, 'rows reserved for nothing');
    const built = build(five.metro, 'x-landscape');
    assert(!canvasOf(built).querySelector('.metro-news'), 'a band with nothing in it');
    assert(built.spec.cross.c1 >= built.view.H - 12, 'the map lost its foot');
  });

  test('a board standing up draws the box off the end of its axis', () => {
    const built = build(withNews(), 'x-portrait');
    const box = built.spec.news;
    assert(box && box.rows >= 1, 'no box on a standing board');
    assert(canvasOf(built).querySelector('.metro-news'), 'the box was not drawn');
    // the axis runs down the panel; it ends above the box
    assert(built.spec.axis.a1 <= built.view.H - box.h + 0.5, 'the axis runs under the box: ' + built.spec.axis.a1 + ' vs ' + (built.view.H - box.h));
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
