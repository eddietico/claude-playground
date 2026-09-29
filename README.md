# Playwright TodoMVC Tests

[![Playwright Tests](https://github.com/eddietico/claude-playground/actions/workflows/playwright.yml/badge.svg)](https://github.com/eddietico/claude-playground/actions/workflows/playwright.yml)

End-to-end tests for the [TodoMVC demo app](https://demo.playwright.dev/todomvc), written in TypeScript with [Playwright](https://playwright.dev). The tests run on Chromium and WebKit, locally and in GitHub Actions.

## Getting started

Requires Node.js (LTS).

```sh
npm ci                               # install dependencies
npx playwright install --with-deps   # install browsers
npx playwright test                  # run the suite
npx playwright show-report           # open the HTML report
```

Other useful commands:

```sh
npx playwright test tests/todo-list.spec.ts   # one file
npx playwright test -g "edits a todo"         # tests matching a title
npx playwright test --project=chromium        # one browser
npx playwright test --ui                      # interactive UI mode
npx playwright test --trace on                # record a trace for every test
```

## Project structure

```
tests/
  pages/todo-page.ts        Page object: locators, user actions, assertions
  todo-list.spec.ts         Add, complete, edit, delete, filter, clear
  persistence.spec.ts       Todos survive a reload, with a simulated slow backend
playwright.config.ts        Browsers, parallelism, retries, reporter
.github/workflows/          CI pipeline
```

## Design

**Page Object Model.** Specs never touch selectors. They call `TodoPage` actions (`addTodo`, `toggle`, `edit`, `delete`, `filter`) and assertion helpers (`expectTodos`, `expectCompleted`, `expectItemsLeft`), so tests read as user steps:

```ts
test('completes a todo', async () => {
  await todoPage.addTodo('buy milk', 'walk the dog');

  await todoPage.toggle('buy milk');

  await todoPage.expectCompleted('buy milk');
  await todoPage.expectItemsLeft(1);
});
```

If the UI changes, only the page object needs updating.

**User-facing locators.** Elements are found by role, label, placeholder or test id (`getByRole('checkbox', { name: 'Toggle Todo' })`) rather than CSS classes. This keeps tests close to how a user sees the page and stops them breaking when styling changes.

**Web-first assertions, no sleeps.** Every check uses assertions that retry until they pass or time out, like `expect(locator).toHaveText(...)`. Nothing in the suite waits for a fixed amount of time.

**Isolated tests.** The app stores todos in `localStorage`, and each test gets a fresh browser context. Every test starts with an empty list, needs no cleanup, and can run in parallel with the others.

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

## Configuration and CI

- Tests run fully in parallel across **Chromium** and **WebKit**. Firefox is disabled for now.
- On CI (`process.env.CI`): 2 retries, 1 worker, and `test.only` fails the build.
- Traces are recorded on the first retry. Reports go to `playwright-report/`.
- [GitHub Actions](.github/workflows/playwright.yml) runs the suite on every push and pull request to `main` and uploads the HTML report as an artifact, kept for 30 days.
