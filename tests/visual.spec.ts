import { test, expect } from './fixtures';

// Screenshot comparisons against committed baselines in
// visual.spec.ts-snapshots/. Baselines are per browser and per OS (fonts and
// anti-aliasing differ), so there's a win32 set for local runs and a linux
// set for CI. See the README for how to update them.
//
// toHaveScreenshot already disables CSS animations and hides the text caret,
// and retakes the screenshot until two in a row match before comparing.

test('empty list', async ({ todoPage }) => {
  await expect(todoPage.page).toHaveScreenshot('empty.png');
});

test.describe('with todos', () => {
  test.use({
    seededTodos: [[{ title: 'buy milk', completed: true }, { title: 'walk the dog' }], { scope: 'test' }],
  });

  test('list', async ({ todoPage }) => {
    await expect(todoPage.page).toHaveScreenshot('list.png');
  });

  test('editing a todo', async ({ todoPage }) => {
    await todoPage.startEditing('walk the dog');
    await expect(todoPage.editor).toBeVisible();

    await expect(todoPage.page).toHaveScreenshot('editing.png');
  });
});
