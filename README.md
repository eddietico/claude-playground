# Playwright TodoMVC Tests

[![Playwright Tests](https://github.com/eddietico/sdet-practice/actions/workflows/playwright.yml/badge.svg)](https://github.com/eddietico/sdet-practice/actions/workflows/playwright.yml)

End-to-end tests for the [TodoMVC demo app](https://demo.playwright.dev/todomvc), written in TypeScript with [Playwright](https://playwright.dev). The tests run on Chromium and WebKit, locally and in GitHub Actions. The demo has no backend, so a separate set of API tests targets the [Restful Booker](https://restful-booker.herokuapp.com) practice API.

## Getting started

Requires Node.js (LTS).

```sh
npm ci                               # install dependencies
npx tsc                              # type-check
npx oxlint --type-aware              # lint (catches a missing `await`)
npx playwright install --with-deps   # install browsers
npx playwright test                  # run the suite
npx playwright show-report           # open the HTML report
```

Other useful commands:

```sh
npx playwright test tests/todo-list.spec.ts   # one file
npx playwright test -g "Escape"               # tests matching a title
npx playwright test --project=chromium        # one browser
npx playwright test --ui                      # interactive UI mode
npx playwright test --trace on                # record a trace for every test
```

## Project structure

```
tests/
  fixtures.ts               `todoPage` and `seededTodos` fixtures; specs import `test` from here
  pages/todo-page.ts        Page object: locators, user actions, assertions
  todo-list.spec.ts         Add, complete, delete, filter, clear
  editing.spec.ts           Edit rules: save, cancel, trim, delete on empty
  persistence.spec.ts       Todos survive a reload, with a simulated slow backend; out-of-order, failed and stale saves
  accessibility.spec.ts     axe scans for WCAG A/AA violations, with a baseline of known ones
  keyboard.spec.ts          Keyboard-only use: tab order, add, complete, clear, filter; known gaps
  visual.spec.ts            Screenshot comparisons; baselines in visual.spec.ts-snapshots/
  api/booking-api.ts        Client for the Restful Booker API (the API's page object)
  api/fixtures.ts           `token`, `api`, `bookingData` and `booking` (created, then deleted) fixtures
  api/booking.spec.ts       Create, read, find, update, delete, auth; known status-code bugs
playwright.config.ts        Browsers, parallelism, retries, reporter
tsconfig.json               Strict type-checking (no output files)
.oxlintrc.json              Lint rules, including no-floating-promises
.github/workflows/          CI pipeline
```

## Design

**Page Object Model.** Specs never touch selectors. They call `TodoPage` actions (`addTodo`, `toggle`, `edit`, `delete`, `filter`) and assertion helpers (`expectTodos`, `expectCompleted`, `expectItemsLeft`), so tests read as user steps:

```ts
test('completes a todo', async ({ todoPage }) => {
  await todoPage.addTodo('buy milk', 'walk the dog');

  await todoPage.toggle('buy milk');

  await todoPage.expectCompleted('buy milk');
  await todoPage.expectItemsLeft(1);
});
```

If the UI changes, only the page object needs updating.

**Fixtures instead of `beforeEach`.** `tests/fixtures.ts` extends Playwright's `test` with a `todoPage` fixture that creates the page object and opens the app. A test asks for it by name, as above, so there is no shared `let` variable and the setup appears in the test's signature. Fixtures are lazy: a test that doesn't ask for `todoPage` never navigates. `persistence.spec.ts` overrides the built-in `page` fixture to install its fake backend. Because `todoPage` depends on `page`, that override runs before the navigation.

**Seeded state, not UI setup.** Tests add todos through the UI only when adding is what they test, or (in the persistence spec) what triggers the save. The others start from todos written into `localStorage` before the app loads, so a broken "add" fails a couple of tests rather than every test. A `describe` block or a whole file sets them with `test.use({ seededTodos: [[...todos], { scope: 'test' }] })`. The list has to be wrapped like that, because Playwright reads a bare array as `[value, options]`, and the fixture throws if you forget. Two things to know:

- The app reads storage only once, when it starts, so the seed is an `addInitScript` registered before navigation.
- Init scripts also run on `reload()`, so the seed only writes to empty storage. Otherwise a reload would wipe out the test's own changes.

The fixture also checks the seeded todos appear with the right completed state, so a seed that silently fails stops the test at setup with a clear error. Seeding didn't make these tests measurably faster: page load from the live demo dominates. The benefit is focus.

**User-facing locators.** Elements are found by role, label, placeholder or test id (`getByRole('checkbox', { name: 'Toggle Todo' })`) rather than CSS classes. This keeps tests close to how a user sees the page and stops them breaking when styling changes.

**Web-first assertions, no sleeps.** Every check uses assertions that retry until they pass or time out, like `expect(locator).toHaveText(...)`. Nothing in the suite waits for a fixed amount of time.

**Isolated tests.** The app stores todos in `localStorage`, and each test gets a fresh browser context. Every test starts with an empty list, needs no cleanup, and can run in parallel with the others.

**Accessibility as a ratchet.** `accessibility.spec.ts` runs [axe](https://github.com/dequelabs/axe-core) on the empty list, a list with todos, and a todo being edited. Two decisions:

- **What fails the build.** Only WCAG 2.2 A and AA rules, the usual compliance target. axe's best-practice rules, such as "the page has no `<main>` landmark", appear in the attached results but don't fail the test.
- **What to do with problems in an app we don't own.** The demo already fails colour contrast in several places, for example the filter links at 4.47:1 against a 4.5:1 minimum. Those are listed in `KNOWN_VIOLATIONS` by rule and element, with reasons, and only new violations fail. Turning off the contrast rule would have been simpler, but it would hide new contrast bugs too.

Breaking the page on purpose showed one limit. Removing a checkbox's accessible name fails the test with `label: .toggle`. But making the todo titles `#eee` on white still passes. The checkbox icon is a background image on the title's `<label>`, so axe can't work out the background colour and reports the title as "incomplete" (needs review), never as a violation. Automated scans cover only part of WCAG, and their `incomplete` results are where a person has to look.

**Keyboard-only tests.** axe checks the markup, but not whether you can actually use the page without a mouse. `keyboard.spec.ts` drives the app with keys alone, with no `click`, `fill` or `focus()`. `TodoPage.tabTo(locator)` presses Tab until the target has focus. It fails if focus reaches the end of the page first, rather than letting Tab wrap round to the top. Without that, a test of the tab order passed with the order reversed.

Adding, completing (Space), marking all, clearing completed and filtering all work. Two things don't, and they're recorded with `test.fail()`, so the suite stays green while they're broken and reports it if the demo ever fixes them:

- **Delete:** the button only appears on hover, so it never takes focus.
- **Edit:** only a double-click opens the editor, and the titles never take focus.

Each was run once without `test.fail()` to check it fails for that reason, because `test.fail()` also passes when a test fails for some other reason. Playwright's WebKit never moves focus to links with Tab, like Safari's default, so the filter test is skipped there.

**Visual regression.** `visual.spec.ts` compares full-page screenshots of three states (empty, with todos, editing) against committed baselines. Screenshots depend on the OS, because fonts and anti-aliasing differ, so Playwright keeps one baseline per browser and OS: `*-win32.png` for local runs on Windows and `*-linux.png` for CI. To update them after an intended UI change:

- **Windows:** `npx playwright test tests/visual.spec.ts --update-snapshots`.
- **Linux:** add the `update-snapshots` label to the PR. The [Update Linux snapshots](.github/workflows/update-snapshots.yml) workflow regenerates them on the same runner image as CI and uploads them as the `linux-snapshots` artifact. Download it with `gh run download <run-id> -n linux-snapshots -D tests` (the artifact keeps the `visual.spec.ts-snapshots/` folder) and commit.

Look at the new images before committing them: the test only checks that the page matches the baseline, not that the baseline is right.

The comparison uses Playwright's defaults, which allow no differing pixels. A per-pixel colour tolerance (`threshold: 0.2`) absorbs small rendering noise. Breaking the page on purpose:

- Hiding "Clear completed" fails (211 pixels differ).
- Shifting the list 1px fails (1,191 pixels).
- Changing the filter links from `#777` to `#767676` passes, below the colour tolerance. Contrast is axe's job.
- With `maxDiffPixelRatio: 0.01`, a common way to quiet screenshot tests that sometimes fail, the hidden button passes too: it's only about 0.02% of the page. So the defaults stay. If a screenshot test fails now and then, fix the cause or screenshot a smaller element; don't loosen the tolerance.

The Windows and Linux baselines differ by 127–219 pixels per image, mostly from font substitution: Linux has no Arial. That's about as much as the missing button (211 pixels), so no tolerance could ignore the OS difference and still catch the button. That's why each OS has its own baselines.

**API tests.** `tests/api/` tests a REST API directly with Playwright's `request` fixture, with no browser. They run once, in an `api` project with its own `baseURL`. `BookingApi` wraps the endpoints the way `TodoPage` wraps the UI, and returns raw responses so tests can check status codes as well as bodies. A few points:

- **Cleanup.** The TodoMVC tests get a fresh `localStorage` each time, but this server is shared and keeps everything. Tests use unique last names, so they can't see each other's data (or anyone else's), and the `booking` fixture deletes its booking after the test. With that delete turned off, all tests still passed and left 4 bookings behind: missing cleanup doesn't fail anything, so check for leftovers.
- **Contracts.** `toEqual({ bookingid: expect.any(Number), booking: data })` checks the response's exact shape, not just a few fields.
- **Auth.** Writes need a token from `/auth`. A test checks that writes without one are rejected and change nothing.
- **Known bugs.** The API returns 200 on create (should be 201), 201 on delete, 200 for wrong credentials (should be 401), and 500 for an incomplete booking (should be 400). These are `test.fail()` tests, each run once without it to check it fails on the status.
- **Availability.** Restful Booker, like the TodoMVC demo, is a third-party service. If it's down, these tests fail even though nothing in the repo changed.

## Case study: fixing a flaky test

`persistence.spec.ts` checks that a todo survives a page reload. The demo saves synchronously, so to test a realistic race, `simulateSlowBackend` makes the app save through a `PUT /api/todos` request. A `page.route` mock answers that request after a random 50–350ms, and the data is only stored once the answer arrives.

The first version of the test waited a fixed 200ms before reloading:

```ts
await todoPage.addTodo('buy milk');
await page.waitForTimeout(200);   // "give the save time to finish"
await page.reload();
```

It passed on the first run. Then:

1. **Reproduce.** `--repeat-each=30` showed it failing about 7% of the time with `Expected ["buy milk"], Received []`.
2. **See how CI hides it.** With `--retries=2`, Playwright reported the test as *flaky*, but the run still exited green.
3. **Capture the failure.** The config records traces `on-first-retry`, which captures the retry, and the retry usually passes. `--trace retain-on-failure` records the failing attempt instead.
4. **Read the trace.** Lining up actions and network requests showed that the save request was answered 48ms *after* `reload()` had torn the page down. The request ended with status `-1` and nothing was stored.
5. **Fix the cause, not the timing.** The test now waits for the save's response. It starts listening *before* the action, so a fast response can't be missed:

```ts
const saved = page.waitForResponse(
  (res) => res.url().endsWith('/api/todos') && res.request().method() === 'PUT',
);
await todoPage.addTodo('buy milk');
await saved;
await page.reload();
```

Result: 200 out of 200 passes with `--repeat-each=100 --fail-on-flaky-tests` on both browsers. A longer sleep would only have made failures rarer, and every run slower.

### A second race: out-of-order saves

With two quick saves (adding two todos), each save gets its own random delay. A test that waited for *both* saves before reloading still failed 9 out of 40 runs: after the reload only "buy milk" was left. The second save, holding both todos, was answered first. Then the first save's older state was written over it.

That's a different kind of bug from the reload race. That one was in the test, which reloaded too early. This one is in the app: the stored data is wrong, and no amount of waiting in the test can fix it. Here's how it was handled:

1. **Make it deterministic.** `simulateSlowBackend` takes optional fixed delays, one per save, set per test with the `saveDelays` option. With the older save answered last (300ms, then 50ms), it failed 10 out of 10. With the other order, it passed 10 out of 10. So the 22% random failure rate was just the chance of the bad order. (On WebKit, fixed delays later turned out not to guarantee the order; the tests now use `saveOrder`. See "Rejecting stale saves on the server" below.)
2. **Fix the app.** The simulated client now numbers its saves and stores a response only if it belongs to the newest save. A real backend would enforce the same rule on the server, rejecting stale writes with a version number or an ETag and `If-Match` (optimistic concurrency). Queueing saves one at a time is the other common fix.
3. **Keep both orders as regression tests.** Removing the version check fails "older save answered last" every time (20 out of 20). A wrong check that only stores the first save fails both orders. With the fix, 120 out of 120 passes with `--repeat-each=20`.

### Failed saves

A probe had the route fail saves on purpose, with `route.fulfill({ status: 500 })` and `route.abort('connectionreset')`. It found two bugs in the simulated client:

- **A 500 was stored as a success.** `fetch` only rejects on network errors. Any HTTP response, including a 500, resolves, so the client has to check `res.ok`.
- **A network error lost the change silently.** There was no retry and no message, and the rejected promise was never handled.

The client now retries 5xx and network errors up to 3 times with exponential backoff (100, 200, 400ms). It doesn't retry a 4xx, because the request itself is wrong and sending it again won't help. It also stops retrying a save once a newer one exists, since every save sends the whole list. If the newest save gives up, the change stays on screen and a `role="alert"` says it wasn't saved, until a later save succeeds. The `saveResponses` option sets each request's outcome, retries included (e.g. `[500, 204]`: fail once, then succeed).

The tests cover a failure that clears up after one retry, one that never clears up, a 400 that isn't retried, and recovery on the next save. They count requests as well as checking the result: "retries and saves" would pass without any retry if the first request happened to succeed. Breaking the client on purpose five ways (no `res.ok` check, retrying a 4xx, 2 retries instead of 3, not clearing the alert, not retrying network errors) failed at least one test each time. The one change no test catches is retrying a save that's already been superseded. It costs an extra request with no visible effect, and proving that a request never happens would need a fixed wait.

### Rejecting stale saves on the server

The out-of-order fix above lived only in the client. To move it to the server, the route mock became a small stateful fake that keeps its own copy of the list (`server.todos`). Tests check that copy directly, the way a real test would check the backend through its API.

**Choosing what "stale" means.** The textbook tool is `If-Match` with a version or ETag. It doesn't fit here: two quick saves are based on the same version, so the second would be rejected even though it's newer. ETags solve a different problem (two users or tabs overwriting each other). For one client's saves, the fit is a sequence number. The client sends `X-Client-Id` (random per page load, because the counter restarts on reload) and `X-Save-Seq`. The server rejects a lower number than one it has already accepted from that client with a **409**, and the client ignores that 409 instead of showing the error alert, because a newer save already carries the change.

**The retry trap.** A retry reuses its save's number. If the server applied a save but the response was lost, a `<=` check would 409 the retry, and the client would report a saved change as failed. So an equal number is accepted again without being re-applied, which makes retries idempotent. A `'lost'` outcome (applied, then the connection drops) tests that.

**What building it exposed:**
- **The server had been silently storing stale data.** With the stateful server but no check, "older save answered last" failed: the server kept only "buy milk". The client's own check had kept the screen right, so no test could see it.
- **The race test hadn't always run the race.** Fixed delays (300ms, then 50ms) count from each request's arrival. When WebKit took over 250ms between the two adds, the first save was answered before the second was even sent. **11 of 20 WebKit runs** never got the order the test is named after, and still passed, because the final data is right in either order. Checking the response statuses (`[204, 409]`) caught it. A `saveOrder` option now holds requests and answers them in a given order, e.g. `[2, 1]`, whatever the timing: 40 of 40 on each browser.

**Breaking it on purpose.** These were each caught: the server applying stale writes, a `<=` check, the client alerting on a superseded 409, and `saveOrder` being ignored (22 of 40 runs failed). Re-applying a duplicate isn't caught, and it doesn't need to be: the data is the same. The race tests wait for the client to finish handling both answers (`waitForHandled`, a counter in the simulated client) before asserting the alert is hidden, so that assertion can't pass before the 409 has been handled. That's insurance: without the wait, the alert bug was still caught 10 of 10.

## Configuration and CI

- UI tests run fully in parallel across **Chromium** and **WebKit**. Firefox is disabled for now. API tests run once, in their own `api` project, without a browser.
- On CI (`process.env.CI`): 2 retries, 1 worker, and `test.only` fails the build.
- Traces are recorded on the first retry. Reports go to `playwright-report/`.
- **Type-checking.** Playwright removes TypeScript types without checking them, so a wrong argument type can still produce a passing test. For example, `expectCompleted('buy milk', 'false')` asserts the opposite of what it says, because `'false'` is truthy. `npx tsc` checks the project with `strict` on. CI runs it before installing browsers, so a type error fails the build within seconds.
- **Linting for a missing `await`.** `tsc` accepts an unawaited promise, but in Playwright a missing `await` makes a test flaky and lets wrong assertions pass. A probe test with `todoPage.toggle(...)` not awaited, followed by a wrong `expectItemsLeft(1)`, passed 9 out of 20 runs. [oxlint](https://oxc.rs) with type-aware linting (`typescript/no-floating-promises`) flags it on every run. ESLint's `typescript-eslint` doesn't support TypeScript 7 yet. CI runs the linter with `--deny-warnings`, next to the type check.
- [GitHub Actions](.github/workflows/playwright.yml) runs the suite on every push and pull request to `main` and uploads the HTML report as an artifact, kept for 30 days. A second workflow, [Update Linux snapshots](.github/workflows/update-snapshots.yml), regenerates the Linux screenshot baselines when a PR gets the `update-snapshots` label.
