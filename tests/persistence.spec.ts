import { test, type Page } from '@playwright/test';
import { TodoPage } from './pages/todo-page';

let todoPage: TodoPage;

/**
 * The demo saves to localStorage synchronously, so it has no real races.
 * Simulate a typical app instead: every save is PUT to a backend, and the
 * data is only persisted once the server responds (after 50-350ms).
 */
async function simulateSlowBackend(page: Page) {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      fetch('/todomvc/api/todos', { method: 'PUT', body: value }).then(() =>
        setItem.call(this, key, value),
      );
    };
  });
  await page.route('**/api/todos', async (route) => {
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 300));
    await route.fulfill({ status: 204 });
  });
}

test.beforeEach(async ({ page }) => {
  await simulateSlowBackend(page);
  todoPage = new TodoPage(page);
  await todoPage.goto();
});

test('todos survive a reload', async ({ page }) => {
  // Start listening before the action so a fast response can't be missed.
  const saved = page.waitForResponse(
    (res) => res.url().endsWith('/api/todos') && res.request().method() === 'PUT',
  );
  await todoPage.addTodo('buy milk');
  await todoPage.expectTodos(['buy milk']);

  await saved;
  await page.reload();

  await todoPage.expectTodos(['buy milk']);
});
