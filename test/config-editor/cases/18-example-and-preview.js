'use strict';

// "LEFT AS IT WAS" HAS TO MEAN NOTHING HAPPENED.
//
// Loading an example over work somebody has done asks first, and answering
// no says "Left as it was." Render the example then went ahead and drew
// anyway -- not the example, which had not been loaded, but whatever the
// user had in the editor. So the button labelled Render the example drew
// their own half-finished configuration, under a line saying nothing had
// changed, and the board that came back was theirs with whichever feeds
// could not be fetched missing from it. That button is gone (an example
// draws when it is picked) and the rule is the same for the pick.

const fs = require('fs');
const path = require('path');

module.exports = function (test, h) {
  const { loadEditor, click, fireInput, assert, assertEqual } = h;
  const REPO_ROOT = path.join(__dirname, '../../..');

  // Only the plugin's own template is readable: the example draws from the
  // ICS text it carries, and calendar.example.com answers nothing.
  const stub = (url) => (/shared\.liquid$/.test(String(url))
    ? Promise.resolve({ ok: true, status: 200,
      text: () => Promise.resolve(fs.readFileSync(path.join(REPO_ROOT, 'plugin/src/shared.liquid'), 'utf-8')) })
    : Promise.reject(new Error('Failed to fetch')));

  test('declining the confirm draws nothing at all', async () => {
    const { window, document } = loadEditor();
    // the user's own work, and a real edit so the confirm is asked for
    document.getElementById('importIn').value = 'https://mine.example/a.ics';
    click(document.getElementById('loadImport'));
    fireInput(document.querySelector('#calendars .card input.who-input'), 'Robin');
    const mine = document.getElementById('jsonOut').value;

    click(document.querySelector('.mc-top nav a[href="#station-demo"]'));
    window.confirm = () => false;
    click(document.querySelector('#presets button[data-preset="family4"]'));
    await h.flush();

    assertEqual(document.getElementById('presetStatus').textContent, 'Left as it was.');
    assertEqual(document.getElementById('jsonOut').value, mine, 'the declined example loaded anyway');
    assertEqual(document.getElementById('previewStatus').textContent, '',
      'Render the example drew the user\'s own configuration after they said no');
    assert(document.getElementById('stage').hidden, 'a board was drawn when nothing was loaded');
  });

  // STARTING FOR REAL CLEARS THE EXAMPLE, INCLUDING ITS PICTURE.
  //
  // "I'm ready to do this for real" empties the lines, the calendars, the
  // rules, the paste box and the example's feeds, so that what follows is
  // about somebody's own calendars. The panel on the right kept Springfield:
  // the board stayed drawn, greyed out as out of date, over a status line
  // reading "10 events today" that counted events from calendars no longer
  // in the editor, with the run() output of that draw still underneath. The
  // first thing a person sees after choosing to do this for real should not
  // be the example they just left.
  test('starting for real clears the example board, not just the example', async () => {
    const { document } = loadEditor(stub);
    click(document.querySelector('#presets button[data-preset="family4"]'));
    await h.flush();
    assert(/event/.test(document.getElementById('previewStatus').textContent),
      'sanity: the example should have drawn');
    assert(!document.getElementById('stage').hidden, 'sanity: there should be a board');

    click(document.getElementById('goReal'));
    click(document.getElementById('chooseManual'));

    assertEqual(document.getElementById('previewStatus').textContent, '',
      'the panel still counts the example\'s events');
    assert(document.getElementById('stage').hidden, 'the example is still drawn on the panel');
    assert(!document.getElementById('stageEmpty').hidden,
      'nothing invites a first draw of the user\'s own calendars');
    assertEqual(document.getElementById('resultJson').value, '',
      'the example\'s run() output is still in the panel');
  });

  test('starting for real clears a prompt generated for the example', () => {
    const { document } = loadEditor();
    click(document.querySelector('#presets button[data-preset="family4"]'));
    // the AI section is reachable from the bar at the top at any stage
    click(document.querySelector('.mc-top nav a[href="#station-agent"]'));
    click(document.getElementById('makePrompt'));
    assert(document.getElementById('promptOut').value.length > 0, 'sanity: a prompt was generated');

    click(document.querySelector('.mc-top nav a[href="#station-demo"]'));
    click(document.getElementById('goReal'));
    click(document.getElementById('chooseAi'));

    assertEqual(document.getElementById('promptOut').value, '',
      'the prompt describing the example survived into the real configuration');
    assert(document.getElementById('relayOffer').hidden, 'the example\'s relay offer is still up');
  });
};
