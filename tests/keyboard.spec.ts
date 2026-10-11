import { test, expect } from './fixtures';

// Everything here uses only the keyboard: no click, fill or focus(). Mouse
// users get the rest of the suite; these check that keyboard users can do
// the same things (WCAG 2.1.1 Keyboard), which axe can't test.

test('adds a todo from the input focused on load', async ({ todoPage }) => {
  await expect(todoPage.newTodoInput).toBeFocused();

  await todoPage.page.keyboard.type('buy milk');
  await todoPage.page.keyboard.press('Enter');

  await todoPage.expectTodos(['buy milk']);
});

test.describe('with todos', () => {
  test.use({
    seededTodos: [[{ title: 'buy milk', completed: true }, { title: 'walk the dog' }], { scope: 'test' }],
  });

  test('reaches the controls in order', async ({ todoPage }) => {
    // Each tabTo continues from the previous focus, so this checks the order.
    // It doesn't check what lies between: links differ by browser (see below).
    await todoPage.tabTo(todoPage.toggleAll);
    await todoPage.tabTo(todoPage.checkbox('buy milk'));
    await todoPage.tabTo(todoPage.checkbox('walk the dog'));
    await todoPage.tabTo(todoPage.clearCompletedButton);
  });

  test('completes a todo with Space', async ({ todoPage }) => {
    await todoPage.tabTo(todoPage.checkbox('walk the dog'));
    await todoPage.page.keyboard.press('Space');

    await todoPage.expectCompleted('walk the dog');
    await todoPage.expectItemsLeft(0);
  });

  test('marks all as complete with Space', async ({ todoPage }) => {
    await todoPage.tabTo(todoPage.toggleAll);
    await todoPage.page.keyboard.press('Space');

    await todoPage.expectCompleted('buy milk');
    await todoPage.expectCompleted('walk the dog');
  });

  test('clears completed with Enter', async ({ todoPage }) => {
    await todoPage.tabTo(todoPage.clearCompletedButton);
    await todoPage.page.keyboard.press('Enter');

    await todoPage.expectTodos(['walk the dog']);
  });

  test('filters with Enter', async ({ todoPage, browserName }) => {
    // Like Safari by default, Playwright's WebKit never moves focus to links
    // with Tab (or Alt+Tab), so the filter links can't be reached there.
    test.skip(browserName === 'webkit', "WebKit doesn't Tab to links");

    await todoPage.tabTo(todoPage.page.getByRole('link', { name: 'Active', exact: true }));
    await todoPage.page.keyboard.press('Enter');

    await todoPage.expectTodos(['walk the dog']);
  });

  // Known gaps in the demo. test.fail() keeps the suite green while they
  // exist and fails ("expected to fail, but passed") if they're ever fixed.
  // It also passes on any failure, including a mistake in the test, so each
  // was checked once without test.fail() to see it fail in tabTo.

  test('deletes a todo', async ({ todoPage }) => {
    test.fail(true, 'The Delete button only appears on hover, so it never takes focus');

    await todoPage.tabTo(todoPage.deleteButton('buy milk'));
    await todoPage.page.keyboard.press('Enter');

    await todoPage.expectTodos(['walk the dog']);
  });

  test('edits a todo', async ({ todoPage }) => {
    test.fail(true, 'Only a double-click opens the editor, and titles never take focus');

    await todoPage.tabTo(todoPage.item('walk the dog').getByTestId('todo-title'));
    await todoPage.page.keyboard.press('Enter');

    await expect(todoPage.editor).toBeFocused();
  });
});
