import { test } from '@playwright/test';
import { TodoPage } from './pages/todo-page';

// Editing rules from the TodoMVC spec:
// https://github.com/tastejs/todomvc/blob/master/app-spec.md#editing

let todoPage: TodoPage;

test.beforeEach(async ({ page }) => {
  todoPage = new TodoPage(page);
  await todoPage.goto();
  // A second todo checks that edits only affect the one being edited.
  await todoPage.addTodo('buy milk', 'walk the dog');
});

for (const end of ['Enter', 'blur'] as const) {
  test(`saves the edit on ${end}`, async () => {
    await todoPage.edit('buy milk', 'buy oat milk', end);

    await todoPage.expectTodos(['buy oat milk', 'walk the dog']);
  });
}

test('cancels the edit on Escape', async () => {
  await todoPage.edit('buy milk', 'buy oat milk', 'Escape');

  // Checking the title alone would also pass if Escape did nothing and the
  // editor stayed open, since an uncommitted edit doesn't change the title.
  await todoPage.expectNotEditing();
  await todoPage.expectTodos(['buy milk', 'walk the dog']);
});

test('trims whitespace from the edited title', async () => {
  await todoPage.edit('buy milk', '   buy oat milk   ');

  // A string would pass either way: toHaveText normalizes whitespace in strings.
  await todoPage.expectTodos([/^buy oat milk$/, 'walk the dog']);
});

for (const [name, text] of [
  ['empty', ''],
  ['whitespace-only', '   '],
]) {
  test(`deletes the todo when the edited title is ${name}`, async () => {
    await todoPage.edit('buy milk', text);

    await todoPage.expectTodos(['walk the dog']);
    await todoPage.expectItemsLeft(1);
  });
}
