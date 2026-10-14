import { type Page, type Response, type Route } from '@playwright/test';
import { test as base, expect } from './fixtures';

/**
 * A save request's outcome: an HTTP status, 'abort' for a dropped connection,
 * or 'lost' for a save the server applied but whose response never arrived.
 */
type SaveResponse = number | 'abort' | 'lost';

/** The fake backend's state. Tests read `todos` to check what the server stored. */
type FakeServer = {
  todos: { title: string; completed: boolean }[];
  /** The highest save number accepted from each client (one per page load). */
  lastSeq: Map<string, number>;
};

type BackendOptions = {
  /** Response delays in ms, one per request (retries included). Random 50-350ms when not set. */
  delays?: number[];
  /** Outcomes, one per request (retries included). 204 when not set. */
  responses?: SaveResponse[];
  /**
   * Request numbers (from 1) in the order to answer them, e.g. [2, 1]. Each
   * waits until the one before it in the list has been answered, so the order
   * holds however far apart the requests are sent. Fixed delays can't promise
   * that: they count from each request, and a slow browser can send the
   * second request after the first one's delay has already run out.
   */
  order?: number[];
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
 *
 * The backend is a `page.route` fake that keeps its own copy in `server`. The
 * demo can only load from localStorage, so a reload shows the client's copy;
 * tests check `server.todos` to see what the backend stored.
 */
async function simulateSlowBackend(
  page: Page,
  server: FakeServer,
  { delays, responses, order }: BackendOptions = {},
) {
  await page.addInitScript(() => {
    const MAX_RETRIES = 3;
    // Save numbers restart at 1 on every page load, so the server tracks them
    // per client. A real app would use a tab or session id.
    const clientId = crypto.randomUUID();
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
        void fetch('/todomvc/api/todos', {
          method: 'PUT',
          body: value,
          // Retries reuse the save's number, so the server can spot duplicates.
          headers: { 'X-Client-Id': clientId, 'X-Save-Seq': String(save) },
        })
          // fetch only rejects on network errors. A 500 resolves too, so
          // check res.ok, or a rejected save would be stored as a success.
          .then(
            (res) => (res.ok ? 'saved' : res.status >= 500 ? 'retry' : 'failed'),
            () => 'retry',
          )
          .then((result) => {
            // Test hook: lets a test wait until the client has handled an
            // answer, not just until the answer was sent (see waitForHandled).
            const w = window as unknown as { handledSaves?: number };
            w.handledSaves = (w.handledSaves ?? 0) + 1;
            // Responses can arrive out of order. Only act on the newest save,
            // or a slow, older one would overwrite it with stale data. This
            // also ignores the 409 the server sends a superseded save.
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
  // Requests listed in `order` wait here for their turn.
  const waiting = new Map<number, () => void>();
  let turn = 0;
  const releaseNext = () => {
    const next = order?.[turn];
    const go = next === undefined ? undefined : waiting.get(next);
    go?.();
  };

  let requests = 0;
  await page.route('**/api/todos', async (route) => {
    const n = ++requests;
    const delay = delays?.[n - 1] ?? 50 + Math.random() * 300;
    await new Promise((r) => setTimeout(r, delay));
    if (!order?.includes(n)) return answer(route, n);
    await new Promise<void>((resolve) => {
      waiting.set(n, resolve);
      releaseNext();
    });
    try {
      await answer(route, n);
    } finally {
      turn++;
      releaseNext();
    }
  });

  async function answer(route: Route, n: number) {
    const response = responses?.[n - 1] ?? 204;
    // A failure set by the test happens before the server applies anything.
    if (response === 'abort') return route.abort('connectionreset');
    if (response !== 'lost' && response >= 400) return route.fulfill({ status: response });

    const req = route.request();
    const client = req.headers()['x-client-id'];
    const seq = Number(req.headers()['x-save-seq']);
    const last = server.lastSeq.get(client) ?? 0;
    // A lower number than one already accepted is a stale write: applying it
    // would overwrite newer data. A real server would do the same with a
    // version number or an ETag and If-Match.
    if (seq < last) return route.fulfill({ status: 409 });
    // An equal number is a retry of a save that was already applied (its
    // response was lost). Accept it again without reapplying, so retries are
    // idempotent; a 409 here would report a saved change as failed.
    if (seq > last) {
      server.todos = JSON.parse(req.postData() ?? '[]');
      server.lastSeq.set(client, seq);
    }

    if (response === 'lost') await route.abort('connectionreset');
    else await route.fulfill({ status: response });
  }
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
// Set the options wrapped, like seededTodos: [[...], { scope: 'test' }].
const test = base.extend<{
  saveDelays: number[] | undefined;
  saveResponses: SaveResponse[] | undefined;
  saveOrder: number[] | undefined;
  server: FakeServer;
}>({
  /** Fixed response delays, one per request (retries included). Random when not set. */
  saveDelays: [undefined, { option: true }],
  /** Outcomes, one per request (retries included). All 204 when not set. */
  saveResponses: [undefined, { option: true }],
  /** Request numbers (from 1) in the order to answer them. Unordered when not set. */
  saveOrder: [undefined, { option: true }],

  // Playwright requires the object pattern even with no dependencies.
  // oxlint-disable-next-line no-empty-pattern
  server: async ({}, use) => {
    await use({ todos: [], lastSeq: new Map() });
  },

  page: async ({ page, server, saveDelays, saveResponses, saveOrder }, use) => {
    await simulateSlowBackend(page, server, {
      delays: saveDelays,
      responses: saveResponses,
      order: saveOrder,
    });
    await use(page);
  },
});

const serverTitles = (server: FakeServer) => server.todos.map((t) => t.title);

/** The alert the client shows when the newest save gives up. */
const saveError = (page: Page) => page.getByRole('alert');

/**
 * Waits until the client has handled `count` answers (aborted requests count
 * too). Unlike waitForSaves, this means the client has already reacted, so a
 * check that something *didn't* happen, like an alert, can't pass too early.
 */
async function waitForHandled(page: Page, count: number) {
  await expect
    .poll(() => page.evaluate(() => (window as { handledSaves?: number }).handledSaves ?? 0))
    .toBe(count);
}

/** Collects the status of every answered save, in the order the answers arrive. */
function recordSaveStatuses(page: Page) {
  const statuses: number[] = [];
  page.on('response', (res) => {
    if (isSave(res)) statuses.push(res.status());
  });
  return statuses;
}

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
// last about 22% of the time, overwriting the newer one. `saveOrder` makes
// each order happen every time. (Fixed delays didn't: on WebKit, 11 of 20
// "older answered last" runs never got that order.) Unlike the reload race
// above, waiting longer in the test can't help: the stored data itself is wrong.
//
// The fix is on both sides. The server rejects a save numbered lower than one
// it already accepted from the same client (409), so its data can't go stale.
// The client ignores answers to superseded saves, so its copy can't either.
// Checking the statuses proves each test really got its order.
for (const [order, saveOrder, statuses] of [
  // The older save is applied second, so the server rejects it.
  ['the older save answered last', [2, 1], [204, 409]],
  ['the newer save answered last', [1, 2], [204, 204]],
] as const) {
  test.describe(`with ${order}`, () => {
    test.use({ saveOrder: [[...saveOrder], { scope: 'test' }] });

    test('keeps the newest save', async ({ page, todoPage, server }) => {
      const answered = recordSaveStatuses(page);
      const saved = waitForSaves(page, 2);
      await todoPage.addTodo('buy milk', 'walk the dog');
      await todoPage.expectTodos(['buy milk', 'walk the dog']);

      await saved;
      expect(serverTitles(server)).toEqual(['buy milk', 'walk the dog']);
      expect(answered).toEqual(statuses);
      // A 409 for a superseded save isn't an error the user needs to see.
      await waitForHandled(page, 2);
      await expect(saveError(page)).toBeHidden();
      await page.reload();

      await todoPage.expectTodos(['buy milk', 'walk the dog']);
    });
  });
}

// Failed saves. Each test sets every request's outcome, retries included, and
// fixed delays so only the outcomes vary.
/** `saveDelays` value: `n` requests answered after 50ms each. */
const fastResponses = (n: number): [number[], { scope: 'test' }] => [
  Array<number>(n).fill(50),
  { scope: 'test' },
];

for (const failure of [500, 'abort'] as const) {
  test.describe(`when a save fails with ${failure}`, () => {
    test.describe('once', () => {
      test.use({ saveResponses: [[failure, 204], { scope: 'test' }], saveDelays: fastResponses(2) });

      test('retries and saves', async ({ page, todoPage, server }) => {
        const counter = countSaveRequests(page);
        const saved = page.waitForResponse((res) => isSave(res) && res.ok());
        await todoPage.addTodo('buy milk');

        await saved;
        expect(counter.requests).toBe(2);
        expect(serverTitles(server)).toEqual(['buy milk']);
        await expect(saveError(page)).toBeHidden();
        await page.reload();

        await todoPage.expectTodos(['buy milk']);
      });
    });

    test.describe('every time', () => {
      test.use({ saveResponses: [Array(4).fill(failure), { scope: 'test' }], saveDelays: fastResponses(4) });

      test('gives up after 3 retries and reports it', async ({ page, todoPage, server }) => {
        const counter = countSaveRequests(page);
        await todoPage.addTodo('buy milk');

        await expect(saveError(page)).toHaveText("Couldn't save your changes");
        expect(counter.requests).toBe(4);
        expect(server.todos).toEqual([]);
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

test.describe('when a save is applied but its response is lost', () => {
  // The server stores the first request, then the connection drops before the
  // answer arrives, so the client retries a save the server already has.
  test.use({ saveResponses: [['lost', 204], { scope: 'test' }], saveDelays: fastResponses(2) });

  test('the retry is accepted as a duplicate', async ({ page, todoPage, server }) => {
    const answered = recordSaveStatuses(page);
    const counter = countSaveRequests(page);
    const saved = page.waitForResponse((res) => isSave(res) && res.ok());
    await todoPage.addTodo('buy milk');

    await saved;
    expect(counter.requests).toBe(2);
    expect(answered).toEqual([204]);
    expect(serverTitles(server)).toEqual(['buy milk']);
    await expect(saveError(page)).toBeHidden();
    await page.reload();

    await todoPage.expectTodos(['buy milk']);
  });
});
