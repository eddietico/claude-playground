import { type Page, type Response } from '@playwright/test';
import { test as base, expect } from './fixtures';

/** A save request's outcome: an HTTP status, or 'abort' for a dropped connection. */
type SaveResponse = number | 'abort';

type BackendOptions = {
  /** Response delays in ms, one per request (retries included). Random 50-350ms when not set. */
  delays?: number[];
  /** Outcomes, one per request (retries included). 204 when not set. */
  responses?: SaveResponse[];
};

/**
 * The demo saves to localStorage synchronously, so it has no real races or
 * failures. Simulate a typical app instead: every save is PUT to a backend,
 * and the data is only persisted once the server accepts it.
 *
 * A save that fails with a 5xx or a network error is retried up to 3 times
 * with backoff. A 4xx isn't retried: the request itself is wrong, so sending
 * it again can't help. If the newest save gives up, the change stays on
 * screen, unsaved, and an alert says so until a later save succeeds.
 */
async function simulateSlowBackend(page: Page, { delays, responses }: BackendOptions = {}) {
  await page.addInitScript(() => {
    const MAX_RETRIES = 3;
    // Called below with .call(this, ...), so `this` isn't lost.
    // oxlint-disable-next-line typescript/unbound-method
    const setItem = Storage.prototype.setItem;
    let latest = 0;

    const showSaveError = (failed: boolean) => {
      const existing = document.getElementById('save-error');
      if (!failed) return existing?.remove();
      if (existing) return;
      const alert = document.createElement('div');
      alert.id = 'save-error';
      alert.setAttribute('role', 'alert');
      alert.textContent = "Couldn't save your changes";
      document.body.prepend(alert);
    };

    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      const save = ++latest;
      const send = (attempt: number) => {
        // Each save sends the whole list, so once there's a newer save this
        // one is redundant: don't retry it, store it or report it. (Untested:
        // a stale retry only costs a request, since its result is ignored
        // below, and proving a request never happens needs a fixed wait.)
        if (save !== latest) return;
        // Not awaited on purpose: setItem is synchronous, and the save
        // finishing in the background is the race this spec is about.
        void fetch('/todomvc/api/todos', { method: 'PUT', body: value })
          // fetch only rejects on network errors. A 500 resolves too, so
          // check res.ok, or a rejected save would be stored as a success.
          .then(
            (res) => (res.ok ? 'saved' : res.status >= 500 ? 'retry' : 'failed'),
            () => 'retry',
          )
          .then((result) => {
            // Responses can arrive out of order. Only act on the newest save,
            // or a slow, older one would overwrite it with stale data.
            if (save !== latest) return;
            if (result === 'saved') {
              setItem.call(this, key, value);
              showSaveError(false);
            } else if (result === 'retry' && attempt < MAX_RETRIES) {
              setTimeout(() => send(attempt + 1), 100 * 2 ** attempt);
            } else {
              showSaveError(true);
            }
          });
      };
      send(0);
    };
  });
  let requests = 0;
  await page.route('**/api/todos', async (route) => {
    const i = requests++;
    const delay = delays?.[i] ?? 50 + Math.random() * 300;
    await new Promise((r) => setTimeout(r, delay));
    const response = responses?.[i] ?? 204;
    if (response === 'abort') await route.abort('connectionreset');
    else await route.fulfill({ status: response });
  });
}

const isSave = (res: Response) =>
  res.url().endsWith('/api/todos') && res.request().method() === 'PUT';

/** Counts save requests, retries included, from when it's called. */
function countSaveRequests(page: Page) {
  const counter = { requests: 0 };
  page.on('request', (req) => {
    if (req.url().endsWith('/api/todos') && req.method() === 'PUT') counter.requests++;
  });
  return counter;
}

/**
 * Resolves once `count` saves have been answered. Call it before the action.
 * An aborted request gets no response, so it doesn't count.
 */
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
// Set both options wrapped, like seededTodos: [[...], { scope: 'test' }].
const test = base.extend<{
  saveDelays: number[] | undefined;
  saveResponses: SaveResponse[] | undefined;
}>({
  /** Fixed response delays, one per request (retries included). Random when not set. */
  saveDelays: [undefined, { option: true }],
  /** Outcomes, one per request (retries included). All 204 when not set. */
  saveResponses: [undefined, { option: true }],

  page: async ({ page, saveDelays, saveResponses }, use) => {
    await simulateSlowBackend(page, { delays: saveDelays, responses: saveResponses });
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

// Failed saves. Each test sets every request's outcome, retries included, and
// fixed delays so only the outcomes vary.
const saveError = (page: Page) => page.getByRole('alert');
/** `saveDelays` value: `n` requests answered after 50ms each. */
const fastResponses = (n: number): [number[], { scope: 'test' }] => [
  Array<number>(n).fill(50),
  { scope: 'test' },
];

for (const failure of [500, 'abort'] as const) {
  test.describe(`when a save fails with ${failure}`, () => {
    test.describe('once', () => {
      test.use({ saveResponses: [[failure, 204], { scope: 'test' }], saveDelays: fastResponses(2) });

      test('retries and saves', async ({ page, todoPage }) => {
        const counter = countSaveRequests(page);
        const saved = page.waitForResponse((res) => isSave(res) && res.ok());
        await todoPage.addTodo('buy milk');

        await saved;
        expect(counter.requests).toBe(2);
        await expect(saveError(page)).toBeHidden();
        await page.reload();

        await todoPage.expectTodos(['buy milk']);
      });
    });

    test.describe('every time', () => {
      test.use({ saveResponses: [Array(4).fill(failure), { scope: 'test' }], saveDelays: fastResponses(4) });

      test('gives up after 3 retries and reports it', async ({ page, todoPage }) => {
        const counter = countSaveRequests(page);
        await todoPage.addTodo('buy milk');

        await expect(saveError(page)).toHaveText("Couldn't save your changes");
        expect(counter.requests).toBe(4);
        // The change stays on screen, so the user can see what wasn't saved.
        await todoPage.expectTodos(['buy milk']);

        await page.reload();
        await todoPage.expectTodos([]);
      });
    });
  });
}

test.describe('when a save is rejected with 400', () => {
  test.use({ saveResponses: [[400], { scope: 'test' }], saveDelays: fastResponses(1) });

  test('reports it without retrying', async ({ page, todoPage }) => {
    const counter = countSaveRequests(page);
    await todoPage.addTodo('buy milk');

    await expect(saveError(page)).toBeVisible();
    expect(counter.requests).toBe(1);
  });
});

test.describe('after a save gives up', () => {
  // Four failed requests for the first save, then the second save succeeds.
  test.use({ saveResponses: [[500, 500, 500, 500, 204], { scope: 'test' }], saveDelays: fastResponses(5) });

  test('the next successful save stores both changes and clears the error', async ({ page, todoPage }) => {
    await todoPage.addTodo('buy milk');
    await expect(saveError(page)).toBeVisible();

    const saved = page.waitForResponse((res) => isSave(res) && res.ok());
    await todoPage.addTodo('walk the dog');
    await saved;
    await expect(saveError(page)).toBeHidden();
    await page.reload();

    await todoPage.expectTodos(['buy milk', 'walk the dog']);
  });
});
