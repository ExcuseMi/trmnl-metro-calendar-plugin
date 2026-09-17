'use strict';

// THE NOW/NEXT CARD, WHICH ONLY EXISTS IN A BROWSER.
//
// Everything this card does is decided from measured text: which of three
// sizes it wears, whether a title is cut at a word, which day's panel it goes
// in, and whether the moon still has room beside it. The jsdom harness cannot
// see any of it -- offsetWidth is zero there, so the card never cuts, never
// shrinks and never competes for space, and a case written over there passes
// whatever the panel does. Every one of the faults below was found by looking
// at a screenshot, which is a slow way to find them twice.

module.exports = function (test, h) {
  const { layout, VIEWPORTS, fixtures, overlap, assert } = h;

  const byName = (n) => VIEWPORTS.find((v) => v.name === n);
  const ROOMY = byName('x-landscape');
  const has = (l, c) => (' ' + l.cls + ' ').indexOf(' ' + c + ' ') >= 0;
  const cardOf = (rep) => rep.labels.filter((l) => has(l, 'metro-nownext'))[0] || null;
  const badgesOf = (rep) => rep.labels.filter((l) => has(l, 'metro-daybadge'));
  const mid = (b) => b.y + b.h / 2;

  for (const f of fixtures) {
    test('the now/next card keeps off everything else in the strip: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const card = cardOf(rep);
      if (!card) return;                       // no clock, or no room: both fine
      const bad = [];
      for (const l of rep.labels) {
        if (l === card || has(l, 'metro-nownext')) continue;
        // the card sits inside the strip, so only the strip's own furniture
        // can be in its way
        if (!(has(l, 'metro-daybadge') || has(l, 'metro-wx') || has(l, 'metro-moon')
              || has(l, 'metro-axis-note'))) continue;
        if (overlap(card, l)) bad.push((l.cls.match(/metro-[a-z]+/) || ['?'])[0] + ' "' + l.text.slice(0, 20) + '"');
      }
      assert(!bad.length, 'the card is written over ' + bad.join(', '));
    });

    test('a one-row card is level with the date beside it: ' + f.name, () => {
      // Centred on the two-row band instead, a single row lands between the
      // date above it and the forecast below, level with neither.
      const rep = layout(f, ROOMY);
      const card = cardOf(rep);
      if (!card) return;
      const badges = badgesOf(rep).filter((b) => b.h > 0);
      if (!badges.length) return;
      // the badge this card was placed against: the nearest one to its left
      const left = badges.filter((b) => b.x <= card.x + 2)
        .sort((p, q) => (card.x - p.x) - (card.x - q.x))[0] || badges[0];
      if (card.h > left.h * 1.6) return;        // a two-row card: centred on the band, correctly
      assert(Math.abs(mid(card) - mid(left)) <= Math.max(4, left.h * 0.35),
        'the card sits ' + Math.round(mid(card) - mid(left)) + 'px off the date "' + left.text.slice(0, 14) + '"');
    });

    test('the card says a whole event where it has the whole strip: ' + f.name, () => {
      const rep = layout(f, ROOMY);
      const card = cardOf(rep);
      if (!card) return;
      // ONLY WHERE THE STRIP IS ONE PANEL. A rolling board splits it between
      // today and tomorrow, and today's half, less its date and its forecast,
      // is a narrow place: rolling-quiet cuts "Swim Training" to "Swim…"
      // there with no room going spare, which is the ladder working rather
      // than failing. Given the whole strip, a cut means it asked for more
      // than it should have.
      if (badgesOf(rep).filter((b) => b.h > 0).length > 1) return;
      assert(!/…/.test(card.text), 'cut on a full-width board: "' + card.text + '"');
    });

    test('a "now" row is never drawn in a later day\'s panel: ' + f.name, () => {
      // The header above a panel is what says which day its contents are
      // about, so "Nu Kantoor" under a badge reading Morgen tells the reader
      // that tomorrow, now, somebody is at the office. Reported from a real
      // board in three words: "Now in tomorrow?". It came of a fallback that
      // drew today's rows in tomorrow's panel when today had no room.
      const rep = layout(f, ROOMY);
      const card = cardOf(rep);
      if (!card) return;
      const badges = badgesOf(rep).filter((b) => b.h > 0).sort((p, q) => p.x - q.x);
      if (badges.length < 2) return;                 // one panel: nowhere else to be
      const nowWord = (f.metro.i18n && f.metro.i18n.now) || 'Now';
      if (card.text.indexOf(nowWord) !== 0) return;  // not a now row
      assert(card.x < badges[1].x,
        'a "' + nowWord + '" row sits in the panel of "' + badges[1].text.slice(0, 14) + '"');
    });

    test('a card with both a now and a next keeps both rows: ' + f.name, () => {
      // WHAT THE BADGE ACTUALLY BROKE, and it was worse than it looked.
      // `.metro-pill` carries its own line-height and an inset top and bottom,
      // so a row with a badge overran the band -- and the card's answer to not
      // fitting is to drop the "Now" line and keep only what is next. busy-day
      // showed "Now Design Review" over "15:30 Sprint Planning" with the badge
      // held inside its line, and only the second of them without.
      //
      // So the assertion is about ROWS, not pixels: a board with something on
      // AND something later today has two things to say and the band is deep
      // enough for both.
      const m = f.metro, now = m.now_min;
      if (now == null) return;
      const evs = (m.events || []).filter((e) => (!e.type || e.type === 'event') && e.start_min != null);
      const midnight = (m.days && m.days[1] && m.days[1].start_min != null) ? m.days[1].start_min : 24 * 60;
      const on = evs.some((e) => e.start_min <= now && (e.end_min || e.start_min) > now);
      const later = evs.some((e) => e.start_min > now && e.start_min < midnight);
      if (!on || !later) return;

      const rep = layout(f, ROOMY);
      const card = cardOf(rep);
      if (!card) return;
      const badges = badgesOf(rep).filter((b) => b.h > 0);
      if (!badges.length) return;
      // a rolling board's today panel is half the strip and may honestly have
      // room for one line only; this is about the boards that have the room
      if (badges.length > 1) return;
      const rows = Math.max(1, Math.round(card.h / badges[0].h));
      assert(rows >= 2, 'both a now and a next, but the card drew ' + rows
        + ' row(s): "' + card.text.slice(0, 40) + '"');
    });

  }
};
