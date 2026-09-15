'use strict';

// THE WARNING HAS TO KEEP UP WITH THE THING IT WARNS ABOUT.
//
// A calendar's name is not a caption: an event no rule routes falls back to
// it, and that name is then drawn as a line. So a calendar called "Work" on
// a board with no Work line is flagged -- unless the calendar routes every
// event somewhere, in which case nothing can reach the fallback and there is
// nothing to warn about.
//
// That test was run when the name was typed and when the line picker moved,
// and not when a RULE changed. Adding the catch-all rule that fixes the
// problem left the warning sitting there in red saying the board would grow
// a line called "Work", which is how a warning stops being read.

module.exports = function (test, h) {
  const { loadEditor, click, fireChange, selectMulti, assert } = h;

  function load(document) {
    document.getElementById('importIn').value = JSON.stringify({
      lines: [{ name: 'Sam' }],
      calendars: [{ name: 'Work', url: 'https://a.example/w.ics' }],
    });
    click(document.getElementById('loadImport'));
  }
  const warning = (document) => document.querySelector('#calendars .cal-name-warn').textContent;

  test('adding a rule that routes every event takes the name warning down', () => {
    const { document } = loadEditor();
    load(document);
    assert(/Work/.test(warning(document)),
      'sanity: a calendar named after no line should be flagged');

    const card = document.querySelector('#calendars .card');
    click([...card.querySelectorAll('button')].find((b) => b.textContent === '+ Add a rule'));
    const rule = card.querySelector('.rule');
    fireChange(rule.querySelector('.cond-type'), 'any');
    selectMulti(rule.querySelector('.line-picker'), ['Sam']);

    assert(!/\S/.test(warning(document)),
      'every event is routed and the warning still says the name will draw a line: ' + warning(document));
  });

  test('removing that rule brings the warning back', () => {
    const { document } = loadEditor();
    load(document);
    const card = document.querySelector('#calendars .card');
    click([...card.querySelectorAll('button')].find((b) => b.textContent === '+ Add a rule'));
    const rule = card.querySelector('.rule');
    fireChange(rule.querySelector('.cond-type'), 'any');
    selectMulti(rule.querySelector('.line-picker'), ['Sam']);
    assert(!/\S/.test(warning(document)), 'sanity: the warning should be down');

    click([...card.querySelectorAll('.rule button')].find((b) => b.textContent === 'Remove rule'));
    assert(/Work/.test(warning(document)),
      'the events can reach the calendar name again and nothing says so');
  });
};
