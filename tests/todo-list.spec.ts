import { test, expect } from './fixtures';

test('has title', async ({ todoPage }) => {
  await expect(todoPage.page).toHaveTitle(/TodoMVC/);
});

test('adds todos', async ({ todoPage }) => {
  await todoPage.addTodo('buy milk', 'walk the dog');

  await todoPage.expectTodos(['buy milk', 'walk the dog']);
  await todoPage.expectItemsLeft(2);
  await expect(todoPage.newTodoInput).toBeEmpty();
});

test('completes a todo', async ({ todoPage }) => {
  await todoPage.addTodo('buy milk', 'walk the dog');

  await todoPage.toggle('buy milk');

  await todoPage.expectCompleted('buy milk');
  await todoPage.expectCompleted('walk the dog', false);
  await todoPage.expectItemsLeft(1);
});

test('marks all as complete', async ({ todoPage }) => {
  await todoPage.addTodo('buy milk', 'walk the dog');

  await todoPage.toggleAllTodos();

  await todoPage.expectCompleted('buy milk');
  await todoPage.expectCompleted('walk the dog');
  await todoPage.expectItemsLeft(0);
});

test('deletes a todo', async ({ todoPage }) => {
  await todoPage.addTodo('buy milk', 'walk the dog');

  await todoPage.delete('buy milk');

  await todoPage.expectTodos(['walk the dog']);
});

test('filters by status', async ({ todoPage }) => {
  await todoPage.addTodo('buy milk', 'walk the dog');
  await todoPage.toggle('buy milk');

  await todoPage.filter('Active');
  await todoPage.expectTodos(['walk the dog']);

  await todoPage.filter('Completed');
  await todoPage.expectTodos(['buy milk']);

  await todoPage.filter('All');
  await todoPage.expectTodos(['buy milk', 'walk the dog']);
});

test('clears completed todos', async ({ todoPage }) => {
  await todoPage.addTodo('buy milk', 'walk the dog');
  await todoPage.toggle('buy milk');

  await todoPage.clearCompleted();

  await todoPage.expectTodos(['walk the dog']);
  await expect(todoPage.clearCompletedButton).toBeHidden();
});
