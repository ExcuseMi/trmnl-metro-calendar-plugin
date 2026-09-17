'use strict';

// The service alert banner (E6). Everything else this suite measures is
// drawn by the script from the METRO payload; the banner is drawn by
// LIQUID, from the same payload, before any of that runs. So it is the one
// part of the board a fixture cannot reach and the one part that had never
// been rendered in a test: it had only been seen by hand-injecting the
// markup into a built page, which proves the CSS and nothing about the
// template. These cases render it for real, through a build of its own
// (`layout(fixture, view, { service_alert: ... })`).
//
// The claim being tested is the one the template's comment makes: the
// banner is a SIBLING of the canvas, so the map gives up exactly its
// height and there is no second place for the two to disagree.

module.exports = function (test, h) {
  const { layout, fixtures, assert, assertEqual } = h;

  const OG = 'screen--og screen--md screen--1bit screen--density-1x';
  const OG2 = 'screen--og screen--md screen--2bit screen--density-1x';
  const X = 'screen--v2 screen--lg screen--4bit screen--density-2x';
  const VIEWS = [
    { name: 'og-landscape', w: 800, h: 480, classes: OG },
    { name: 'og-quadrant', w: 800, h: 480, slot: { w: 400, h: 240 }, classes: OG },
    { name: 'x-landscape', w: 1872, h: 1404, classes: X },
  ];
  // Every bit depth the label's colour is mapped for, which is the whole
  // reason it is a framework class and not a colour of this file's.
  const DEPTHS = VIEWS.concat([{ name: 'og-2bit', w: 800, h: 480, classes: OG2 }]);
  const busy = fixtures.find((f) => f.name === 'busy-day');

  // What transform.js actually composes, copied from the English strings
  // rather than invented here: the banner is fully assembled and translated
  // by then, and the template's whole job is to print it unchanged.
  const ICONS = 'https://trmnl.com/images/plugins/weather/';
  const RAIN = { kind: 'rain', icon: ICONS + 'wi-rain.svg', label: 'Weather',
                 text: 'Rain from 14:00 until 17:00, 80% chance' };
  // One of the longest lines this plugin can produce: a German snow alert
  // out of i18n/de.json, label and all. It is one line on a full OG board
  // and two on a quadrant, which is the case E6 was left open on.
  const LONG = { kind: 'snow', icon: ICONS + 'wi-snow.svg', label: 'Wetter',
                 text: 'Schnee ab 17:00 bis in die Nacht, 80\u00a0% Wahrscheinlichkeit' };
  // The control for the wrap case: the same band, one line, same padding.
  const SHORT = { kind: 'rain', icon: ICONS + 'wi-rain.svg', label: 'Wetter', text: 'Regen' };

  test('the banner prints what transform composed, unchanged', () => {
    for (const v of VIEWS) {
      const rep = layout(busy, v, { service_alert: RAIN });
      assert(rep.banner, v.name + ': service_alert was set and no banner was drawn at all');
      assertEqual(rep.banner.text, RAIN.text, v.name + ': the banner text');
      assertEqual(rep.banner.label && rep.banner.label.text, RAIN.label, v.name + ': the label');
      assertEqual(rep.banner.icon && rep.banner.icon.src, RAIN.icon, v.name + ': the icon');
      // The kind reaches the markup as an attribute so a stylesheet can
      // tell a snow day from a hot one without parsing the sentence.
      assertEqual(rep.banner.kind, RAIN.kind, v.name + ': data-metro-alert');
      // icon, label, message, in that order along one row
      assert(rep.banner.icon.x < rep.banner.label.x && rep.banner.label.x < rep.banner.message.x,
        v.name + ': the parts are out of order: icon ' + Math.round(rep.banner.icon.x) + ', label '
        + Math.round(rep.banner.label.x) + ', message ' + Math.round(rep.banner.message.x));
    }
  });

  test('no alert, no banner: the element is absent, not empty', () => {
    // `null` is what lets the map have the height back. A zero-height band
    // still occupies a flex slot and still carries its own padding, so
    // "collapses completely" has to mean the element is not there.
    for (const v of VIEWS) {
      const rep = layout(busy, v);
      assertEqual(rep.banner, null, v.name + ': a board with no alert drew a banner anyway');
    }
  });

  test('the banner takes its height OFF the map, not out of it', () => {
    // The sibling-of-the-canvas claim, stated as arithmetic: the root is
    // the same height either way, the header is untouched, so whatever the
    // banner takes is exactly what the canvas loses. A banner moved inside
    // the canvas, or positioned absolutely over it, breaks this and
    // nothing else in the suite would notice: the map would simply be
    // drawn under an opaque black bar.
    for (const v of VIEWS) {
      const withAlert = layout(busy, v, { service_alert: RAIN });
      assert(withAlert.banner, v.name + ': service_alert was set and no banner was drawn');
      const without = layout(busy, v);
      const lost = without.canvas.h - withAlert.canvas.h;
      // 1px: the two heights are laid out independently and either can
      // land on a subpixel boundary. Anything looser would let a banner
      // that overlaps the map by a line of text through.
      assert(Math.abs(lost - withAlert.banner.h) <= 1, v.name + ': the banner is '
        + Math.round(withAlert.banner.h) + 'px tall but the canvas only gave up '
        + Math.round(lost) + 'px');
      // and it sits below the map rather than on it (canvas-relative, so
      // the canvas's own bottom edge is exactly canvas.h)
      assert(withAlert.banner.y >= withAlert.canvas.h - 1, v.name + ': the banner starts '
        + Math.round(withAlert.canvas.h - withAlert.banner.y) + 'px above the bottom of the map');
    }
  });

  test('the banner does not push the board off its own panel', () => {
    // A flex-none band at the bottom of a column that does not shrink
    // grows the column instead, and a board taller than its slot is not
    // reported anywhere: the device just cuts the bottom off, which on
    // this board means cutting off the alert. Checked on the busiest
    // fixtures and at the smallest slot, where there is least to give.
    for (const f of ['busy-day', 'seven-lines', 'full-day']) {
      const fx = fixtures.find((x) => x.name === f);
      for (const v of VIEWS) {
        const rep = layout(fx, v, { service_alert: RAIN });
        assert(rep.banner, f + ' ' + v.name + ': no banner was drawn');
        const over = (rep.root.y + rep.root.h) - (rep.view.y + rep.view.h);
        assert(over <= 1, f + ' ' + v.name + ': the board runs ' + Math.round(over)
          + 'px past the bottom of its ' + (v.slot ? v.slot.w + 'x' + v.slot.h : v.w + 'x' + v.h)
          + ' panel');
        const cut = (rep.banner.y + rep.banner.h) - (rep.view.y + rep.view.h);
        assert(cut <= 1, f + ' ' + v.name + ': ' + Math.round(cut)
          + 'px of the banner is off the bottom of the panel');
      }
    }
  });

  test('a banner translation that wraps to two lines still fits on the board', () => {
    // The German snow line is 57 characters. On a quadrant it wraps, and
    // wrapping is allowed on purpose (an alert cut in half is worse than a
    // tall one) but only if the second line is on the panel and the map
    // has paid for it.
    // The quadrant's OWN build, not the full view scaled into a 400px slot:
    // the framework sets its type larger there, and that is where a long
    // alert actually wraps on a real device.
    const v = { name: 'og-quadrant-view', page: 'quadrant', w: 400, h: 240, classes: OG };
    const long = layout(busy, v, { service_alert: LONG });
    assert(long.banner, 'no banner on the quadrant');
    assertEqual(long.banner.text, LONG.text, 'the long banner was cut short');
    // Measured against the SAME banner carrying a short string rather than
    // against a line height plus padding: the band's own padding is most
    // of a line, so "taller than one and a half lines" was true of a
    // one-line banner too and this case was quietly not about wrapping at
    // all.
    const one = layout(busy, v, { service_alert: SHORT });
    const grew = long.banner.h - one.banner.h;
    assert(grew >= one.banner.lineHeight * 0.8, 'this case is only about a banner that wraps, '
      + 'and this one did not: ' + Math.round(long.banner.h) + 'px against '
      + Math.round(one.banner.h) + 'px for a short string. Pick a longer string or a '
      + 'narrower slot.');
    // The root is the whole board; the banner's last line has to be inside it.
    const rootBottom = long.root.y + long.root.h;
    assert(long.banner.y + long.banner.h <= rootBottom + 1, 'the wrapped banner runs '
      + Math.round(long.banner.y + long.banner.h - rootBottom) + 'px off the bottom of the board');
    const lost = layout(busy, v).canvas.h - long.canvas.h;
    assert(Math.abs(lost - long.banner.h) <= 1, 'the two-line banner is '
      + Math.round(long.banner.h) + 'px tall but the canvas gave up ' + Math.round(lost) + 'px');
  });

  test('the banner label, "Weather", stands out from the band on every bit depth', () => {
    // "Have the label in a trmnl class like important (works for different
    // screens)". The error colour is a dither on a 1-bit panel and a pale
    // grey on the X, and on a black band either one swallowed the word, so
    // a grey panel wears the filled label instead: paper on ink, the way the
    // date sits in the hour strip. What this asserts is that it is SEEN: a
    // box of its own that is not the band's colour, with words that are not
    // the box's colour.
    for (const v of DEPTHS) {
      const rep = layout(busy, v, { service_alert: RAIN });
      const l = rep.banner && rep.banner.label;
      assert(l, v.name + ': no label on the banner');
      assert(l.bg !== rep.banner.ink, v.name + ': the label is ' + l.bg + ' on a ' + rep.banner.ink
        + ' band, so it has no box of its own');
      assert(l.color !== l.bg, v.name + ': the label reads ' + l.color + ' on ' + l.bg + ', which is invisible');
      assert(l.bgImage === 'none' || !l.bgImage, v.name + ': the label is dithered (' + l.bgImage
        + '), which on this panel is a grey smear under the word');
    }
  });

  test('the banner icon is drawn in the band\'s paper, and the message is larger than the label', () => {
    // An adaptive icon is a mask painted in the text colour, so on the ink
    // band it comes out white by itself; a plain image would be a black
    // glyph on black. And the message is the sentence being read: "a bit
    // larger and nicer font" than the small label it used to be set in.
    for (const v of VIEWS) {
      const rep = layout(busy, v, { service_alert: RAIN });
      const b = rep.banner;
      assert(b && b.icon, v.name + ': no icon on the banner');
      assert(b.icon.w >= b.message.fontSize && b.icon.h >= b.message.fontSize, v.name + ': the icon is '
        + Math.round(b.icon.w) + 'px, smaller than the ' + b.message.fontSize + 'px words beside it');
      assert(/wi-rain\.svg/.test(b.icon.mask), v.name + ': the icon is not masked, so it is not recoloured: '
        + b.icon.mask);
      assertEqual(b.icon.bg, b.paper, v.name + ': the icon is painted ' + b.icon.bg + ' on the ' + b.ink + ' band');
      assertEqual(b.message.color, b.paper, v.name + ': the message should be in the band\'s paper');
      assert(b.message.fontSize > b.label.fontSize, v.name + ': the message (' + b.message.fontSize
        + 'px) is no larger than the label (' + b.label.fontSize + 'px)');
      assert(b.radius > 0, v.name + ': the band has square corners');
    }
  });

  test('solid ink, paper text: the banner reads as an interruption', () => {
    // It is the one thing on the board that is not part of the map, and it
    // has to look like it. Both colours come from framework variables with
    // literal fallbacks, so a mistyped variable name still renders black on
    // white on a light board. What it would break is the INVERSION, which
    // is what this asserts rather than the two hex values.
    for (const v of VIEWS) {
      const rep = layout(busy, v, { service_alert: RAIN });
      assert(rep.banner, v.name + ': service_alert was set and no banner was drawn');
      assert(rep.banner.ink !== rep.banner.paper, v.name + ': the banner is '
        + rep.banner.paper + ' text on a ' + rep.banner.ink + ' band, which is invisible');
      assertEqual(rep.banner.paper, rep.boardBg, v.name + ': the banner text should be knocked '
        + 'out of the band in the canvas colour (' + rep.boardBg + ')');
      assert(rep.banner.ink !== rep.boardBg, v.name + ': the band is the same colour as the '
        + 'board, so it is not a band');
    }
  });

  // THE SENTENCE IN THREE WEIGHTS. transform.js splits the banner at its own
  // placeholders and the template prints each piece in its own span; whether
  // that actually lands as bold and as grey is a computed style, and this is
  // the only harness that has one.
  const PARTS = {
    kind: 'rain', icon: ICONS + 'wi-rain.svg', label: 'Weather',
    text: 'Rain from 14:00 until 17:00, 80% chance',
    parts: [{ t: 'Rain', s: 'b' }, { t: ' from ', s: '' }, { t: '14:00', s: 'q' },
            { t: ' until ', s: '' }, { t: '17:00,', s: 'q' }, { t: ' ', s: '' },
            { t: '80%', s: 'b' }, { t: ' chance', s: '' }],
  };

  test('the banner sets the thing bold and the clock quiet', () => {
    const rep = layout(busy, VIEWS[2], { service_alert: PARTS });
    assertEqual(rep.banner.text, PARTS.text, 'the pieces must still read as the line');
    const pieces = rep.banner.pieces || [];
    assert(pieces.length > 1, 'the banner was printed as one piece: ' + JSON.stringify(pieces));
    const weight = (t) => (pieces.filter((p) => p.text.indexOf(t) >= 0)[0] || {}).weight;
    const plain = (pieces.filter((p) => p.text.indexOf('from') >= 0)[0] || {}).weight;
    assert(+weight('Rain') > +plain, 'the thing itself is not bolder than the words around it: '
      + weight('Rain') + ' vs ' + plain);
    const clock = pieces.filter((p) => p.text.indexOf('14:00') >= 0)[0];
    const body = pieces.filter((p) => p.text.indexOf('from') >= 0)[0];
    assert(clock && body && clock.color !== body.color,
      'the clock is the same colour as the words: ' + JSON.stringify([clock, body]));
  });

  test('a banner with no parts still prints its whole line', () => {
    // Older saved state and anything else that never learned about `parts`.
    const rep = layout(busy, VIEWS[2], { service_alert: RAIN });
    assertEqual(rep.banner.text, RAIN.text, 'the fallback dropped the sentence');
  });
};
