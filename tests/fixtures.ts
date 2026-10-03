import { test as base } from '@playwright/test';
import { TodoPage } from './pages/todo-page';

type Fixtures = {
  /** A TodoPage already navigated to the demo, with an empty list. */
  todoPage: TodoPage;
};

/**
 * Specs import `test` and `expect` from here instead of '@playwright/test'.
 *
 * Fixtures are lazy: `todoPage` is only built (and the page only navigated)
 * for tests or hooks that ask for it. It depends on the built-in `page`, so a
 * spec that overrides `page` gets that override here too.
 */
export const test = base.extend<Fixtures>({
  todoPage: async ({ page }, use) => {
    const todoPage = new TodoPage(page);
    await todoPage.goto();
    await use(todoPage);
    // Code after use() is teardown. None is needed: each test gets a fresh
    // browser context, so its localStorage (and the todos) is thrown away.
  },
});

export { expect } from '@playwright/test';
