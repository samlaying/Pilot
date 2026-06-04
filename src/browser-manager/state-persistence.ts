/**
 * StatePersistence — save/restore/persist browser state (cookies, storage).
 */

import type { Cookie } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { SharedState, BrowserState } from './shared-state.js';
import { STATE_FILE_PATH, STATE_DIR_PATH } from './shared-state.js';

export interface IStatePersistence {
  saveState(): Promise<BrowserState>;
  restoreState(state: BrowserState): Promise<void>;
  persistState(): Promise<void>;
  clearPersistedState(): Promise<void>;
  saveSessionToFile(filePath: string): Promise<number>;
  loadSessionFromFile(filePath: string): Promise<number>;
  clearSession(): Promise<void>;
}

export class StatePersistence implements IStatePersistence {
  constructor(
    private state: SharedState,
    private wirePageEvents: (page: import('playwright').Page) => void,
    private clearRefs: () => void,
    private newTab: (url?: string) => Promise<number>,
  ) {}

  async saveState(): Promise<BrowserState> {
    if (!this.state.context) throw new Error('Browser not launched');
    const cookies = await this.state.context.cookies();
    const pages: BrowserState['pages'] = [];

    for (const [id, page] of this.state.pages) {
      const url = page.url();
      let storage = null;
      try {
        storage = await page.evaluate(() => ({
          localStorage: { ...localStorage },
          sessionStorage: { ...sessionStorage },
        }));
      } catch {}
      pages.push({
        url: url === 'about:blank' ? '' : url,
        isActive: id === this.state.activeTabId,
        storage,
      });
    }
    return { cookies, pages };
  }

  async restoreState(state: BrowserState): Promise<void> {
    if (!this.state.context) throw new Error('Browser not launched');
    if (state.cookies.length > 0) {
      await this.state.context.addCookies(state.cookies);
    }

    let activeId: number | null = null;
    for (const saved of state.pages) {
      const page = await this.state.context.newPage();
      const id = this.state.nextTabId++;
      this.state.pages.set(id, page);
      this.wirePageEvents(page);

      if (saved.url) {
        await page.goto(saved.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }

      if (saved.storage) {
        try {
          await page.evaluate((s: { localStorage: Record<string, string>; sessionStorage: Record<string, string> }) => {
            if (s.localStorage) {
              for (const [k, v] of Object.entries(s.localStorage)) {
                localStorage.setItem(k, v);
              }
            }
            if (s.sessionStorage) {
              for (const [k, v] of Object.entries(s.sessionStorage)) {
                sessionStorage.setItem(k, v);
              }
            }
          }, saved.storage);
        } catch {}
      }
      if (saved.isActive) activeId = id;
    }

    if (this.state.pages.size === 0) {
      await this.newTab();
    } else {
      this.state.activeTabId = activeId ?? [...this.state.pages.keys()][0];
    }
    this.clearRefs();
  }

  async persistState(): Promise<void> {
    if (!this.state.context) return;
    try {
      const cookies = await this.state.context.cookies();
      if (cookies.length === 0) return;
      fs.mkdirSync(STATE_DIR_PATH, { recursive: true });
      fs.writeFileSync(STATE_FILE_PATH, JSON.stringify({ cookies }, null, 2));
      console.error(`[pilot] Persisted ${cookies.length} cookies to ${STATE_FILE_PATH}`);
    } catch (err) {
      console.error(`[pilot] Failed to persist state: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async loadPersistedState(): Promise<void> {
    if (!this.state.context) return;
    try {
      if (!fs.existsSync(STATE_FILE_PATH)) return;
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      const { cookies } = JSON.parse(raw) as { cookies: Cookie[] };
      if (cookies && cookies.length > 0) {
        await this.state.context.addCookies(cookies);
        console.error(`[pilot] Restored ${cookies.length} cookies from ${STATE_FILE_PATH}`);
      }
    } catch (err) {
      console.error(`[pilot] Failed to restore state: ${err instanceof Error ? err.message : err}`);
    }
  }

  async clearPersistedState(): Promise<void> {
    try {
      if (fs.existsSync(STATE_FILE_PATH)) {
        fs.unlinkSync(STATE_FILE_PATH);
        console.error('[pilot] Cleared persisted state');
      }
    } catch {}
  }

  async saveSessionToFile(filePath: string): Promise<number> {
    const state = await this.saveState();
    const resolvedPath = filePath.replace(/^~/, os.homedir());
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, JSON.stringify(state, null, 2));
    return state.cookies.length;
  }

  async loadSessionFromFile(filePath: string): Promise<number> {
    if (!this.state.context) throw new Error('Browser not launched');
    const resolvedPath = filePath.replace(/^~/, os.homedir());
    if (!fs.existsSync(resolvedPath)) throw new Error(`Session file not found: ${resolvedPath}`);
    const state = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')) as BrowserState;
    if (state.cookies && state.cookies.length > 0) {
      await this.state.context.addCookies(state.cookies);
    }
    const activePage = this.state.pages.get(this.state.activeTabId);
    if (activePage) {
      const savedPage = state.pages?.find(p => p.isActive) ?? state.pages?.[0];
      if (savedPage?.storage) {
        try {
          await activePage.evaluate((s) => {
            for (const [k, v] of Object.entries(s.localStorage || {})) localStorage.setItem(k, v);
            for (const [k, v] of Object.entries(s.sessionStorage || {})) sessionStorage.setItem(k, v);
          }, savedPage.storage);
        } catch {}
      }
    }
    return state.cookies?.length ?? 0;
  }

  async clearSession(): Promise<void> {
    if (!this.state.context) throw new Error('Browser not launched');
    await this.state.context.clearCookies();
    for (const page of this.state.pages.values()) {
      try {
        await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      } catch {}
    }
  }
}
