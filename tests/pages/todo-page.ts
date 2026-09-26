import { expect, type Locator, type Page } from '@playwright/test';

export type Filter = 'All' | 'Active' | 'Completed';

/**
 * Page Object for the TodoMVC demo at https://demo.playwright.dev/todomvc.
 *
 * Actions return nothing; assertions live on the page object as `expect*`
 * helpers so specs read as user steps plus checks.
 */
export class TodoPage {
  readonly url = 'https://demo.playwright.dev/todomvc';

  readonly newTodoInput: Locator;
  readonly items: Locator;
  readonly titles: Locator;
  readonly toggleAll: Locator;
  readonly count: Locator;
  readonly clearCompletedButton: Locator;

  constructor(readonly page: Page) {
    this.newTodoInput = page.getByPlaceholder('What needs to be done?');
    this.items = page.getByTestId('todo-item');
    this.titles = page.getByTestId('todo-title');
    this.toggleAll = page.getByLabel('Mark all as complete');
    this.count = page.getByTestId('todo-count');
    this.clearCompletedButton = page.getByRole('button', { name: 'Clear completed' });
  }

  async goto() {
    await this.page.goto(this.url);
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

  async edit(title: string, newTitle: string) {
    await this.item(title).getByTestId('todo-title').dblclick();
    const editor = this.page.getByRole('textbox', { name: 'Edit' });
    await editor.fill(newTitle);
    await editor.press('Enter');
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

  async expectTodos(titles: string[]) {
    await expect(this.titles).toHaveText(titles);
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
