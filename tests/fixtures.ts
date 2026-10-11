import { test as base } from '@playwright/test';
import { TodoPage, type SeedTodo } from './pages/todo-page';

type Fixtures = {
  /**
   * Todos in storage when the app loads. Wrap the list when setting it:
   * `test.use({ seededTodos: [[...todos], { scope: 'test' }] })`. Playwright
   * reads a bare array as `[value, options]`, so `[todoA, todoB]` would seed
   * only todoA. TypeScript can't catch that: it's a valid SeedTodo[] too.
   */
  seededTodos: SeedTodo[];
  /** A TodoPage already navigated to the demo, showing `seededTodos` (empty by default). */
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
  seededTodos: [[], { option: true }],

  todoPage: async ({ page, seededTodos }, use) => {
    // Catch a missing wrapper (see seededTodos above), which would otherwise
    // seed nothing and skip the check below.
    if (!Array.isArray(seededTodos)) {
      throw new Error(
        `seededTodos must be wrapped: test.use({ seededTodos: [[...todos], { scope: 'test' }] })`,
      );
    }
    const todoPage = new TodoPage(page);
    if (seededTodos.length) await todoPage.seed(seededTodos);
    await todoPage.goto();
    // Check the seed took, so a broken seed fails here with a clear message
    // instead of as a timeout in whichever step first needs a todo.
    if (seededTodos.length) await todoPage.expectTodos(seededTodos.map((t) => t.title));
    await use(todoPage);
    // Code after use() is teardown. None is needed: each test gets a fresh
    // browser context, so its localStorage (and the todos) is thrown away.
  },
});

export { expect } from '@playwright/test';
