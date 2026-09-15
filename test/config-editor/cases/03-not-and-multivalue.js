module.exports = function (test, h) {
  const { loadEditor, fireInput, fireChange, click, buttonByText, checkByLabel, jsonOut, selectMulti, assert, assertEqual } = h;

  // Setting the PERSON up before the rule/condition matters: a person
  // arriving re-renders #globalRules (so every rule can offer them in its
  // picker), which would detach any rule/condition DOM reference grabbed
  // beforehand. And a person arrives by a calendar being answered for, which
  // is the only way this page makes one.
  function ruleWithCondition(document, value, negate) {
    h.addFeed(document, 'https://a.example/sam.ics', 'Sam');
    click(document.getElementById('addGlobalRule'));
    const rule = document.querySelector('#globalRules .rule');
    fireInput(rule.querySelector('.cond input[type=text]'), value);
    if (negate) click(buttonByText(rule, 'not'));
    selectMulti(rule.querySelector('.line-picker'), ['Sam']);
    return rule;
  }

  test('a comma-separated value exports as an "or" of that type', () => {
    const { document } = loadEditor();
    ruleWithCondition(document, 'L1, L3, L4');
    assertEqual(jsonOut(document).rules[0].match, {
      type: 'or',
      matchers: [{ type: 'word', value: 'L1' }, { type: 'word', value: 'L3' }, { type: 'word', value: 'L4' }],
    });
  });

  test('clicking "not" wraps the condition in a not-matcher', () => {
    const { document } = loadEditor();
    ruleWithCondition(document, 'L2', true);
    assertEqual(jsonOut(document).rules[0].match, { type: 'not', matcher: { type: 'word', value: 'L2' } });
  });

  test('"not" combined with a comma-separated value produces not(or(...))', () => {
    const { document } = loadEditor();
    const rule = ruleWithCondition(document, 'L2, L6', true);
    const hide = checkByLabel(rule, 'hide it from the map');
    hide.checked = true; fireChange(hide);
    assertEqual(jsonOut(document).rules[0].match, {
      type: 'not',
      matcher: { type: 'or', matchers: [{ type: 'word', value: 'L2' }, { type: 'word', value: 'L6' }] },
    });
    assertEqual(jsonOut(document).rules[0].hide, true);
  });

  test('clicking "not" again turns it back off', () => {
    const { document } = loadEditor();
    const rule = ruleWithCondition(document, 'L2', true);
    click(buttonByText(rule, 'not'));
    assertEqual(jsonOut(document).rules[0].match, { type: 'word', value: 'L2' });
  });

  test('importing not(or(word...)) round-trips back into one negated, comma-joined condition', () => {
    const { document } = loadEditor();
    const cfg = {
      lines: [{ name: 'Familie' }, { name: 'Jules' }],
      rules: [{
        match: { type: 'and', matchers: [
          { type: 'or', matchers: [{ type: 'word', value: 'L1' }, { type: 'word', value: 'L3' }] },
          { type: 'not', matcher: { type: 'word', value: 'L2' } },
        ] },
        hide: true,
      }],
    };
    document.getElementById('importIn').value = JSON.stringify(cfg);
    click(document.getElementById('loadImport'));
    const conds = document.querySelectorAll('#globalRules .rule .cond');
    assertEqual(conds.length, 2, 'two conditions: the or-collapsed word list, and the negated L2');
    assertEqual(conds[0].querySelector('input[type=text]').value, 'L1, L3');
    assert(!conds[0].querySelector('button.primary'), 'first condition is not negated');
    assertEqual(conds[1].querySelector('input[type=text]').value, 'L2');
    assert(!!conds[1].querySelector('button.primary'), 'second condition (not L2) should show the "not" toggle active');
    assertEqual(jsonOut(document).rules[0], cfg.rules[0]);
  });
};
