import { type Page } from '@playwright/test';
import { test as base } from './fixtures';

/**
 * The demo saves to localStorage synchronously, so it has no real races.
 * Simulate a typical app instead: every save is PUT to a backend, and the
 * data is only persisted once the server responds (after 50-350ms).
 */
async function simulateSlowBackend(page: Page) {
  await page.addInitScript(() => {
    // Called below with .call(this, ...), so `this` isn't lost.
    // oxlint-disable-next-line typescript/unbound-method
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      // Not awaited on purpose: setItem is synchronous, and the save
      // finishing in the background is the race this spec is about.
      void fetch('/todomvc/api/todos', { method: 'PUT', body: value }).then(() =>
        setItem.call(this, key, value),
      );
    };
  });
  await page.route('**/api/todos', async (route) => {
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 300));
    await route.fulfill({ status: 204 });
  });
}

// Override `page` for this file only. The todoPage fixture depends on `page`,
// so the slow backend is installed before todoPage navigates, which
// addInitScript needs.
const test = base.extend({
  page: async ({ page }, use) => {
    await simulateSlowBackend(page);
    await use(page);
  },
});

test('todos survive a reload', async ({ page, todoPage }) => {
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
