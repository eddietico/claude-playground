# Playwright TodoMVC Tests

[![Playwright Tests](https://github.com/eddietico/claude-playground/actions/workflows/playwright.yml/badge.svg)](https://github.com/eddietico/claude-playground/actions/workflows/playwright.yml)

End-to-end tests for the [TodoMVC demo app](https://demo.playwright.dev/todomvc), written in TypeScript with [Playwright](https://playwright.dev). The tests run on Chromium and WebKit, locally and in GitHub Actions.

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
  persistence.spec.ts       Todos survive a reload, with a simulated slow backend
  accessibility.spec.ts     axe scans for WCAG A/AA violations, with a baseline of known ones
  keyboard.spec.ts          Keyboard-only use: tab order, add, complete, clear, filter; known gaps
  visual.spec.ts            Screenshot comparisons; baselines in visual.spec.ts-snapshots/
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
- **Type-checking.** Playwright removes TypeScript types without checking them, so a wrong argument type can still produce a passing test. For example, `expectCompleted('buy milk', 'false')` asserts the opposite of what it says, because `'false'` is truthy. `npx tsc` checks the project with `strict` on. CI runs it before installing browsers, so a type error fails the build within seconds.
- **Linting for a missing `await`.** `tsc` accepts an unawaited promise, but in Playwright a missing `await` makes a test flaky and lets wrong assertions pass. A probe test with `todoPage.toggle(...)` not awaited, followed by a wrong `expectItemsLeft(1)`, passed 9 out of 20 runs. [oxlint](https://oxc.rs) with type-aware linting (`typescript/no-floating-promises`) flags it on every run. ESLint's `typescript-eslint` doesn't support TypeScript 7 yet. CI runs the linter with `--deny-warnings`, next to the type check.
- [GitHub Actions](.github/workflows/playwright.yml) runs the suite on every push and pull request to `main` and uploads the HTML report as an artifact, kept for 30 days. A second workflow, [Update Linux snapshots](.github/workflows/update-snapshots.yml), regenerates the Linux screenshot baselines when a PR gets the `update-snapshots` label.
