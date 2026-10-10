import { test, expect } from './fixtures';

test('has title', async ({ todoPage }) => {
  await expect(todoPage.page).toHaveTitle(/TodoMVC/);
});

// Adding through the UI is the behaviour under test here; the other tests
// seed their todos instead, so they only fail when their own feature breaks.
test('adds todos', async ({ todoPage }) => {
  await todoPage.addTodo('buy milk', 'walk the dog');

  await todoPage.expectTodos(['buy milk', 'walk the dog']);
  await todoPage.expectItemsLeft(2);
  await expect(todoPage.newTodoInput).toBeEmpty();
});

test.describe('with two active todos', () => {
  test.use({
    seededTodos: [[{ title: 'buy milk' }, { title: 'walk the dog' }], { scope: 'test' }],
  });

  test('completes a todo', async ({ todoPage }) => {
    await todoPage.toggle('buy milk');

    await todoPage.expectCompleted('buy milk');
    await todoPage.expectCompleted('walk the dog', false);
    await todoPage.expectItemsLeft(1);
  });

  test('marks all as complete', async ({ todoPage }) => {
    await todoPage.toggleAllTodos();

    await todoPage.expectCompleted('buy milk');
    await todoPage.expectCompleted('walk the dog');
    await todoPage.expectItemsLeft(0);
  });

  test('deletes a todo', async ({ todoPage }) => {
    await todoPage.delete('buy milk');

    await todoPage.expectTodos(['walk the dog']);
  });

  // Also checks the seed itself: it must not overwrite the app's saves when
  // its init script runs again on reload.
  test('keeps changes after a reload', async ({ todoPage }) => {
    await todoPage.toggle('buy milk');
    await todoPage.expectCompleted('buy milk');

    await todoPage.page.reload();

    await todoPage.expectCompleted('buy milk');
  });
});

test.describe('with one completed todo', () => {
  test.use({
    seededTodos: [
      [{ title: 'buy milk', completed: true }, { title: 'walk the dog' }],
      { scope: 'test' },
    ],
  });

  test('starts with the seeded state', async ({ todoPage }) => {
    await todoPage.expectCompleted('buy milk');
    await todoPage.expectCompleted('walk the dog', false);
    await todoPage.expectItemsLeft(1);
  });

  test('filters by status', async ({ todoPage }) => {
    await todoPage.filter('Active');
    await todoPage.expectTodos(['walk the dog']);

    await todoPage.filter('Completed');
    await todoPage.expectTodos(['buy milk']);

    await todoPage.filter('All');
    await todoPage.expectTodos(['buy milk', 'walk the dog']);
  });

  test('clears completed todos', async ({ todoPage }) => {
    await todoPage.clearCompleted();

    await todoPage.expectTodos(['walk the dog']);
    await expect(todoPage.clearCompletedButton).toBeHidden();
  });
});
