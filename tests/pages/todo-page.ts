import { expect, type Locator, type Page } from '@playwright/test';

export type Filter = 'All' | 'Active' | 'Completed';

/** How an edit ends: Enter and blur save it, Escape cancels it. */
export type EditEnd = 'Enter' | 'Escape' | 'blur';

/** A todo to put in storage before the app loads. */
export type SeedTodo = { title: string; completed?: boolean };

/**
 * Page Object for the TodoMVC demo at https://demo.playwright.dev/todomvc.
 *
 * Actions return nothing; assertions live on the page object as `expect*`
 * helpers so specs read as user steps plus checks.
 */
export class TodoPage {
  readonly url = 'https://demo.playwright.dev/todomvc';
  /** The app reads this localStorage key once, when its script starts. */
  readonly storageKey = 'react-todos';

  readonly newTodoInput: Locator;
  readonly items: Locator;
  readonly titles: Locator;
  readonly toggleAll: Locator;
  readonly count: Locator;
  readonly clearCompletedButton: Locator;
  readonly editor: Locator;

  constructor(readonly page: Page) {
    this.newTodoInput = page.getByPlaceholder('What needs to be done?');
    this.items = page.getByTestId('todo-item');
    this.titles = page.getByTestId('todo-title');
    this.toggleAll = page.getByLabel('Mark all as complete');
    this.count = page.getByTestId('todo-count');
    this.clearCompletedButton = page.getByRole('button', { name: 'Clear completed' });
    this.editor = page.getByRole('textbox', { name: 'Edit' });
  }

  async goto() {
    await this.page.goto(this.url);
  }

  /**
   * Store todos for the app to load, skipping the UI. Call before goto():
   * the app only reads storage at startup.
   */
  async seed(todos: SeedTodo[]) {
    const stored = todos.map(({ title, completed = false }) => ({
      id: crypto.randomUUID(),
      title,
      completed,
    }));
    await this.page.addInitScript(
      ({ key, value }) => {
        // Init scripts run on every load, reload() included. Only seed an
        // empty list, or a reload would overwrite the app's own saves.
        if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
      },
      { key: this.storageKey, value: JSON.stringify(stored) },
    );
  }

  /** The <li> for the todo with exactly this title. */
  item(title: string): Locator {
    return this.items.filter({
      has: this.page.getByTestId('todo-title').getByText(title, { exact: true }),
    });
  }

  async addTodo(...titles: string[]) {
    for (const title of titles) {
      await this.newTodoInput.fill(title);
      await this.newTodoInput.press('Enter');
    }
  }

  async toggle(title: string) {
    await this.item(title).getByRole('checkbox', { name: 'Toggle Todo' }).click();
  }

  async toggleAllTodos() {
    await this.toggleAll.check();
  }

  async edit(title: string, newTitle: string, end: EditEnd = 'Enter') {
    await this.item(title).getByTestId('todo-title').dblclick();
    await this.editor.fill(newTitle);
    if (end === 'blur') {
      // Click away like a user would, rather than calling locator.blur().
      await this.page.getByRole('heading', { name: 'todos' }).click();
    } else {
      await this.editor.press(end);
    }
  }

  async delete(title: string) {
    const item = this.item(title);
    // The delete button is only rendered visible on hover.
    await item.hover();
    await item.getByRole('button', { name: 'Delete' }).click();
  }

  async filter(name: Filter) {
    await this.page.getByRole('link', { name, exact: true }).click();
  }

  async clearCompleted() {
    await this.clearCompletedButton.click();
  }

  /** Strings ignore surrounding whitespace; use an anchored RegExp to match exactly. */
  async expectTodos(titles: (string | RegExp)[]) {
    await expect(this.titles).toHaveText(titles);
  }

  async expectNotEditing() {
    await expect(this.editor).toBeHidden();
  }

  async expectCompleted(title: string, completed = true) {
    const item = this.item(title);
    if (completed) await expect(item).toHaveClass(/completed/);
    else await expect(item).not.toHaveClass(/completed/);
  }

  async expectItemsLeft(n: number) {
    await expect(this.count).toHaveText(`${n} ${n === 1 ? 'item' : 'items'} left`);
  }
}
