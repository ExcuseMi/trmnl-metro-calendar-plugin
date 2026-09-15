'use strict';

// settings.yml: the form every reader configures the board through.
//
// Nothing else in this repo reads it, so nothing else catches it being
// wrong. It goes wrong quietly in both directions: transform.js reads a
// setting the form never offers (dead code and a feature nobody can turn
// on), or the form offers one transform.js never reads (a switch that
// does nothing). Both have happened.
//
// The other half is the CONDITIONAL fields. A field that only applies
// under one setting has to be hidden under the others, or the form asks
// for an answer it will not use, which reads as a broken plugin rather
// than an irrelevant question. Those are declared as `conditional_validation`
// blocks naming keynames, and a keyname is exactly the kind of thing a
// rename leaves behind pointing at nothing.
//
// Deliberately parsed with a tiny reader rather than a YAML library: the
// transform suite has no dependencies, and the shape it has to understand
// is four kinds of line.

const fs = require('fs');
const path = require('path');

const SETTINGS = path.join(__dirname, '../../../plugin/src/settings.yml');
const TRANSFORM = path.join(__dirname, '../../../plugin/src/transform.js');

function parseFields(text) {
  const lines = text.split('\n');
  const fields = [];
  let f = null, list = null, cond = null;
  let inFields = false;
  for (const line of lines) {
    if (/^custom_fields:\s*$/.test(line)) { inFields = true; continue; }
    if (!inFields) continue;
    // Back out to the top level and the list is over. A list ITEM also
    // starts in column zero, so it is anything-but-a-dash that ends it.
    if (/^[^\s-]/.test(line)) break;

    let m = /^- keyname: (\S+)/.exec(line);
    if (m) { f = { keyname: m[1], options: [], conditions: [] }; fields.push(f); list = cond = null; continue; }
    if (!f) continue;

    if (/^  options:\s*$/.test(line)) { list = 'options'; cond = null; continue; }
    if (/^  conditional_validation:\s*$/.test(line)) { list = 'cond'; cond = null; continue; }

    if (list === 'options') {
      m = /^  - .*: *(\S+)\s*$/.exec(line);
      if (m) { f.options.push(m[1]); continue; }
    }
    if (list === 'cond') {
      m = /^  - when: *'?([^'\s]+)'?\s*$/.exec(line);
      if (m) { cond = { when: m[1], hidden: [] }; f.conditions.push(cond); continue; }
      m = /^    - (\S+)\s*$/.exec(line);
      if (m && cond) { cond.hidden.push(m[1]); continue; }
      if (/^    hidden:\s*$/.test(line)) continue;
    }

    m = /^  (\w+): ?(.*)$/.exec(line);
    if (m && m[1] !== 'options' && m[1] !== 'conditional_validation') {
      f[m[1]] = m[2];
      if (m[1] !== 'description') list = null;
    }
  }
  return fields;
}

module.exports = function (test, h) {
  const { assert, assertEqual } = h;

  const FIELDS = parseFields(fs.readFileSync(SETTINGS, 'utf-8'));
  const BY_KEY = {};
  FIELDS.forEach((f) => { BY_KEY[f.keyname] = f; });
  const SRC = fs.readFileSync(TRANSFORM, 'utf-8');

  test('the form and the code agree on which settings exist', async () => {
    assert(FIELDS.length > 5, 'the settings file barely parsed: ' + FIELDS.length + ' field(s)');

    // Any helper that takes (input, 'keyname'), not just cf: the alert
    // thresholds go through numSetting, and a reader that only knew about
    // cf would call three live settings dead.
    const read = new Set();
    const re = /\(\s*input\s*,\s*'([a-z0-9_]+)'/g;
    let m;
    while ((m = re.exec(SRC))) read.add(m[1]);
    assert(read.size > 5, 'found almost no settings being read: ' + [...read].join(', '));

    const missing = [...read].filter((k) => !BY_KEY[k]);
    assertEqual(missing, [], 'transform.js reads settings the form never offers');

    // The other direction, minus the two that are display only: an
    // author_bio is a block of text, not an answer.
    const DISPLAY_ONLY = ['author_info'];
    const unread = FIELDS.map((f) => f.keyname)
      .filter((k) => DISPLAY_ONLY.indexOf(k) < 0 && !read.has(k));
    assertEqual(unread, [], 'the form offers settings nothing reads');
  });

  test('every conditional names a field that exists, and a value that exists', async () => {
    FIELDS.forEach((f) => {
      f.conditions.forEach((c) => {
        c.hidden.forEach((k) => {
          assert(BY_KEY[k], f.keyname + ' hides "' + k + '", which is not a setting');
          assert(k !== f.keyname, f.keyname + ' hides itself');
        });
        if (f.field_type === 'select') {
          assert(f.options.indexOf(c.when) >= 0,
            f.keyname + ' has a rule for "' + c.when + '", which is not one of its options (' + f.options.join(', ') + ')');
        } else if (f.field_type === 'boolean') {
          assert(c.when === 'true' || c.when === 'false',
            f.keyname + ' is a checkbox with a rule for "' + c.when + '"');
        }
      });
    });
  });

  test('a setting the board no longer reads is not still asked for', async () => {
    // Three settings used to live in "The Day" and all three are gone,
    // because the rolling window answers what each of them was asking:
    //
    //   Switch Over At -- an hour to swap today for tomorrow at.
    //   Show -- which day to draw, including that swap.
    //   Quiet Days -- whether a quiet day may borrow the next one at all.
    //
    // Rolling reaches tomorrow from four in the afternoon, keeps what is left
    // of tonight while it does, and stretches to the end of tomorrow once
    // today is spent. A settings page that offers a choice the transform
    // ignores is worse than one that offers nothing, so this case watches
    // both halves: off the form AND out of the code.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../plugin/src/transform.js'), 'utf-8');
    ['show_day', 'switch_hour', 'rolling_view'].forEach((k) => {
      assert(!BY_KEY[k], k + ' is still on the form with nothing behind it');
      assert(src.indexOf("cf(input, '" + k + "')") < 0,
        'the transform still reads ' + k + ', which the form no longer asks for');
    });
  });

  test('turning the alert banner off takes its thresholds with it', async () => {
    const off = (BY_KEY.alert_enabled.conditions.find((c) => c.when === 'false') || {}).hidden || [];
    ['alert_rain_threshold', 'alert_temp_low', 'alert_temp_high'].forEach((k) => {
      assert(off.indexOf(k) >= 0, k + ' is still asked for with the banner switched off');
    });
  });

  // THE DEMO IS NOT A SETUP STEP.
  //
  // It used to be: Use Demo Data shipped on, and it hid the Calendars box
  // until you found it and turned it off. But an empty box already rides
  // the demo, so the switch was asking people to turn off the thing that
  // was going to happen anyway. It is an override now, off, after the
  // setup fields. The example PICKER is not behind it: it chooses what an
  // empty box shows, which is exactly when the override is off.
  test('nobody has to find a switch to see the board work', async () => {
    const demo = BY_KEY.use_demo_data;
    assertEqual(demo.default, 'false', 'the demo override ships on, so it hides the box it should leave open');
    assertEqual(BY_KEY.demo_set.group, demo.group, 'the example picker is not with its switch');
    const hidden = [].concat(...demo.conditions.map((c) => c.hidden));
    assert(hidden.indexOf('config_json') < 0, 'the demo override hides the Calendars box');
    assert(hidden.indexOf('demo_set') < 0, 'the example picker is hidden while it decides what an empty box shows');
    const keys = FIELDS.map((f) => f.keyname);
    assert(keys.indexOf('use_demo_data') > keys.indexOf('config_json'), 'the demo override comes before the calendars');
  });

  test('every setting is optional and says what it does', async () => {
    // A board has to render on a device nobody has configured yet, so
    // there is no such thing as a required field here.
    FIELDS.forEach((f) => {
      if (f.field_type === 'author_bio') return;
      assertEqual(f.optional, 'true', f.keyname + ' is not optional');
      assert((f.description || '').length > 20, f.keyname + ' has no real description');
      assert(f.name, f.keyname + ' has no label');
    });
  });

  test('a default is one of the choices offered', async () => {
    FIELDS.forEach((f) => {
      if (f.default == null || f.field_type !== 'select') return;
      assert(f.options.indexOf(f.default) >= 0,
        f.keyname + ' defaults to "' + f.default + '", which is not one of ' + f.options.join(', '));
    });
  });

  // A PLAIN YAML SCALAR CANNOT CONTAIN ": ".
  //
  // There is no YAML parser in this suite -- the reader above is a
  // deliberate 30 lines of regex -- so an unquoted description with a colon
  // in it parsed perfectly here and made trmnlp refuse the whole file:
  // "mapping values are not allowed in this context". Every view in the
  // layout suite then failed to build at once, which is a long way to go
  // for a punctuation mark. The existing descriptions that use a colon are
  // quoted; this says so.
  test('a description with a colon in it is quoted, or the file will not parse', async () => {
    const text = fs.readFileSync(SETTINGS, 'utf-8');
    const bad = [];
    text.split('\n').forEach((line, i) => {
      const m = /^(\s+)(description|name|placeholder|help_text): (.*)$/.exec(line);
      if (!m) return;
      const v = m[3];
      // Already quoted, or a block scalar: YAML reads the value as text
      // and a colon inside it is just a colon.
      if (/^['"|>]/.test(v)) return;
      if (/: /.test(v)) bad.push('line ' + (i + 1) + ': ' + m[2]);
    });
    assertEqual(bad, [], 'unquoted YAML scalars containing ": " -- trmnlp will refuse the file');
  });

  test('no em dash reaches the reader', async () => {
    // House rule, and the form is the one file in the plugin whose text
    // is read by everyone who installs it.
    const bad = fs.readFileSync(SETTINGS, 'utf-8').split('\n')
      .map((l, i) => (l.indexOf('—') >= 0 ? (i + 1) + ': ' + l.trim().slice(0, 60) : null))
      .filter(Boolean);
    assertEqual(bad, [], 'em dash in settings.yml');
  });
};
