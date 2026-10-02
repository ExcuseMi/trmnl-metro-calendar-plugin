'use strict';

// trmnlp lint, as plugin/lint.sh runs it, inside the suite: clean, except the
// one warning that is wrong.
//
// `trmnlp lint` checks each custom field's `field_type` against a list
// vendored inside the gem, and that list predates `lat_lon`, the hosted
// service's Location picker, which this plugin's Location setting uses and the
// hosted service accepts on every push. The exception is narrow: that exact
// warning, and only while settings.yml really does ask for `lat_lon`.
//
// Lint also counts the STRINGS `padding`, `margin`, `font-size` and five more
// anywhere in the liquid, comments included (AGENTS.md), which is the check
// most likely to go red after a comment is written.

const fs = require('fs');
const path = require('path');
const { test, expect, config } = require('trmnlp-test');

test('trmnlp lint is clean, apart from the stale lat_lon field type', async ({ trmnl }) => {
  const settings = fs.readFileSync(path.join(config.root, config.plugin, 'src', 'settings.yml'), 'utf-8');
  expect(/field_type: lat_lon/.test(settings), 'settings.yml no longer uses lat_lon: delete the exception here and in plugin/lint.sh').toBe(true);
  const lint = await trmnl.lint();
  expect(lint).toPassLint({ allow: ['unknown field_type: lat_lon'] });
});
