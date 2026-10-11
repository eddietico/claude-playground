import { type Page, type Response } from '@playwright/test';
import { test as base } from './fixtures';

/**
 * The demo saves to localStorage synchronously, so it has no real races.
 * Simulate a typical app instead: every save is PUT to a backend, and the
 * data is only persisted once the server responds. Responses take 50-350ms
 * at random, or the given `delays` in order, one per save.
 */
async function simulateSlowBackend(page: Page, delays?: number[]) {
  await page.addInitScript(() => {
    // Called below with .call(this, ...), so `this` isn't lost.
    // oxlint-disable-next-line typescript/unbound-method
    const setItem = Storage.prototype.setItem;
    let latest = 0;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      const save = ++latest;
      // Not awaited on purpose: setItem is synchronous, and the save
      // finishing in the background is the race this spec is about.
      void fetch('/todomvc/api/todos', { method: 'PUT', body: value }).then(() => {
        // Responses can arrive out of order. Only store the newest save, or a
        // slow, older one would overwrite it with stale data.
        if (save === latest) setItem.call(this, key, value);
      });
    };
  });
  let saves = 0;
  await page.route('**/api/todos', async (route) => {
    const delay = delays?.[saves++] ?? 50 + Math.random() * 300;
    await new Promise((r) => setTimeout(r, delay));
    await route.fulfill({ status: 204 });
  });
}

const isSave = (res: Response) =>
  res.url().endsWith('/api/todos') && res.request().method() === 'PUT';

/** Resolves once `count` saves have been answered. Call it before the action. */
function waitForSaves(page: Page, count: number) {
  return new Promise<void>((resolve) => {
    let answered = 0;
    const onResponse = (res: Response) => {
      if (isSave(res) && ++answered === count) {
        page.off('response', onResponse);
        resolve();
      }
    };
    page.on('response', onResponse);
  });
}

// Override `page` for this file only. The todoPage fixture depends on `page`,
// so the slow backend is installed before todoPage navigates, which
// addInitScript needs.
const test = base.extend<{ saveDelays: number[] | undefined }>({
  /** Fixed response delays, one per save. Random when not set. */
  saveDelays: [undefined, { option: true }],

  page: async ({ page, saveDelays }, use) => {
    await simulateSlowBackend(page, saveDelays);
    await use(page);
  },
});

test('todos survive a reload', async ({ page, todoPage }) => {
  // Start listening before the action so a fast response can't be missed.
  const saved = page.waitForResponse(isSave);
  await todoPage.addTodo('buy milk');
  await todoPage.expectTodos(['buy milk']);

  await saved;
  await page.reload();

  await todoPage.expectTodos(['buy milk']);
});

// Two quick saves race each other. With random delays the older one landed
// last about 22% of the time, overwriting the newer one. Fixed delays make
// each order happen every time. Unlike the reload race above, waiting longer
// in the test can't help: the stored data itself is wrong.
for (const [order, delays] of [
  ['the older save answered last', [300, 50]],
  ['the newer save answered last', [50, 300]],
] as const) {
  test.describe(`with ${order}`, () => {
    test.use({ saveDelays: [[...delays], { scope: 'test' }] });

    test('keeps the newest save', async ({ page, todoPage }) => {
      const saved = waitForSaves(page, 2);
      await todoPage.addTodo('buy milk', 'walk the dog');
      await todoPage.expectTodos(['buy milk', 'walk the dog']);

      await saved;
      await page.reload();

      await todoPage.expectTodos(['buy milk', 'walk the dog']);
    });
  });
}
