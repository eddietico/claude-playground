import AxeBuilder from '@axe-core/playwright';
import { type Page, type TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';

// The gate is WCAG 2.2 A and AA, the usual compliance target. axe's
// best-practice rules (e.g. "page has no <main> landmark") are reported in
// the attached results but don't fail the test.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

// Blind spot: axe can't check the todo titles' contrast. The checkbox icon is
// a background image on the title's <label>, so axe reports it as
// "incomplete" (needs review), never as a violation. Titles made #eee on
// white still pass. axe's `incomplete` results need a person to check them.

// Violations the demo already has. We don't own the app, so instead of
// failing forever (or disabling whole rules, which would hide new problems)
// they're listed here and only new violations fail. Each is `rule: element`.
const KNOWN_VIOLATIONS = new Set([
  // The big "todos" heading is a pale pink on grey (1.26:1, needs 3:1).
  'color-contrast: h1',
  // Footer text and links (1.68:1, needs 4.5:1).
  'color-contrast: p:nth-child(1)',
  'color-contrast: p:nth-child(2)',
  'color-contrast: p:nth-child(3)',
  'color-contrast: a[href$="remojansen/"]',
  'color-contrast: a[href$="todomvc.com"]',
  // Filter links, #777 on white: 4.47:1, just under 4.5:1.
  'color-contrast: .selected',
  'color-contrast: a[href$="#/active"]',
  'color-contrast: a[href$="#/completed"]',
]);

/** Scan the page and return WCAG violations that aren't in the baseline. */
async function newViolations(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  // The full results, for the HTML report.
  await testInfo.attach('axe-results', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  return results.violations.flatMap((v) =>
    v.nodes
      .map((node) => `${v.id}: ${node.target.join(' ')}`)
      .filter((violation) => !KNOWN_VIOLATIONS.has(violation)),
  );
}

test('empty list has no new violations', async ({ todoPage }, testInfo) => {
  expect(await newViolations(todoPage.page, testInfo)).toEqual([]);
});

test.describe('with todos', () => {
  // A completed todo also shows "Clear completed".
  test.use({
    seededTodos: [[{ title: 'buy milk', completed: true }, { title: 'walk the dog' }], { scope: 'test' }],
  });

  test('list has no new violations', async ({ todoPage }, testInfo) => {
    expect(await newViolations(todoPage.page, testInfo)).toEqual([]);
  });

  test('editing a todo has no new violations', async ({ todoPage }, testInfo) => {
    await todoPage.startEditing('walk the dog');
    // Without this, a double-click that failed to open the editor would
    // still pass, having scanned the wrong state.
    await expect(todoPage.editor).toBeVisible();

    expect(await newViolations(todoPage.page, testInfo)).toEqual([]);
  });
});
