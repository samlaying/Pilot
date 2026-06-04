/**
 * TabManager — manages browser tabs (create, close, switch, list).
 */

import type { Page } from 'playwright';
import { validateNavigationUrl } from '../url-validation.js';
import type { SharedState } from './shared-state.js';

export interface ITabManager {
  newTab(url?: string): Promise<number>;
  closeTab(id?: number): Promise<void>;
  switchTab(id: number): void;
  getTabCount(): number;
  getTabListWithTitles(): Promise<Array<{ id: number; url: string; title: string; active: boolean }>>;
  getPage(): Page;
  getCurrentUrl(): string;
}

export class TabManager implements ITabManager {
  constructor(
    private state: SharedState,
    private wirePageEvents: (page: Page) => void,
    private clearRefs: () => void,
  ) {}

  async newTab(url?: string): Promise<number> {
    if (!this.state.context) throw new Error('Browser not launched');
    if (url) await validateNavigationUrl(url);

    const page = await this.state.context.newPage();
    const id = this.state.nextTabId++;
    this.state.pages.set(id, page);
    this.state.activeTabId = id;
    this.wirePageEvents(page);

    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    }
    return id;
  }

  async closeTab(id?: number): Promise<void> {
    const tabId = id ?? this.state.activeTabId;
    const page = this.state.pages.get(tabId);
    if (!page) throw new Error(`Tab ${tabId} not found`);

    await page.close();
    this.state.pages.delete(tabId);

    if (tabId === this.state.activeTabId) {
      const remaining = [...this.state.pages.keys()];
      if (remaining.length > 0) {
        this.state.activeTabId = remaining[remaining.length - 1];
      } else {
        await this.newTab();
      }
    }
  }

  switchTab(id: number): void {
    if (!this.state.pages.has(id)) throw new Error(`Tab ${id} not found`);
    this.state.activeTabId = id;
  }

  getTabCount(): number {
    return this.state.pages.size;
  }

  async getTabListWithTitles(): Promise<Array<{ id: number; url: string; title: string; active: boolean }>> {
    const tabs: Array<{ id: number; url: string; title: string; active: boolean }> = [];
    for (const [id, page] of this.state.pages) {
      tabs.push({
        id,
        url: page.url(),
        title: await page.title().catch(() => ''),
        active: id === this.state.activeTabId,
      });
    }
    return tabs;
  }

  getPage(): Page {
    const page = this.state.pages.get(this.state.activeTabId);
    if (!page) throw new Error('No active page. Use pilot_navigate first.');
    return page;
  }

  getCurrentUrl(): string {
    try {
      return this.getPage().url();
    } catch {
      return 'about:blank';
    }
  }
}
