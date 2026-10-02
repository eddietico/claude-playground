# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A Playwright end-to-end testing playground (TypeScript). There is no application code: the repo holds Playwright config and specs under `tests/`, which run against the external TodoMVC demo at `https://demo.playwright.dev/todomvc`. No `baseURL` or `webServer` is configured; the URL lives in the page object.

Specs use the Page Object Model: page objects live in `tests/pages/` (e.g. `TodoPage` in `tests/pages/todo-page.ts`) and expose locators, user actions (`addTodo`, `toggle`, `edit`, …) and `expect*` assertion helpers. Specs should go through the page object rather than using raw selectors. The demo stores todos in each browser context's `localStorage`, so every test starts with an empty list and needs no cleanup.

`tests/todo-list.spec.ts` covers core list behaviour. `tests/editing.spec.ts` covers the TodoMVC spec's editing rules (Enter/blur save, Escape cancels, trimming, empty deletes); `expectTodos` string matches ignore surrounding whitespace, so use an anchored RegExp when whitespace matters. `tests/persistence.spec.ts` checks todos survive a reload; because the demo saves synchronously, it uses `simulateSlowBackend` (an `addInitScript` patch plus a `page.route` mock with random latency) to make saves async, and waits on the save's `PUT` response before reloading. Don't replace that wait with `waitForTimeout`: it's the fix for a real race.

## Commands

There are no npm scripts; use `npx playwright` directly.

```sh
npm ci                                   # install dependencies
npx playwright install --with-deps       # install browser binaries (first run / after upgrading Playwright)
npx playwright test                      # run all tests on chromium and webkit
npx playwright test tests/todo-list.spec.ts        # run a single file
npx playwright test -g "has title"                 # run tests matching a title
npx playwright test --project=chromium             # run a single browser project
npx playwright test --headed / --ui / --debug      # interactive modes
npx playwright show-report                         # open the HTML report from the last run
npx playwright codegen <url>                       # record a new test
```

## Configuration notes

- `playwright.config.ts`: `testDir` is `./tests`; tests run fully parallel across two projects (chromium, webkit). Firefox is intentionally disabled for now (commented out in the config); don't re-enable it unless asked.
- CI-specific behaviour is keyed off `process.env.CI`: `test.only` fails the run, retries = 2, and workers = 1. Locally there are no retries.
- Traces are only collected `on-first-retry`, so locally you get none unless you pass `--trace on`.
- The reporter is `html`; output goes to `playwright-report/` and `test-results/` (both gitignored).

## CI

`.github/workflows/playwright.yml` runs on push/PR to `main`/`master`: `npm ci`, installs browsers, runs `npx playwright test` on ubuntu-latest with Node LTS, and uploads `playwright-report/` as an artifact (30-day retention).
