/**
 * BrowserLifecycle — manages browser launch, close, health, CDP, handoff,
 * and context recreation.
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from 'playwright';
import { extensionServer } from '../extension-server.js';
import type { SharedState, BrowserState } from './shared-state.js';
import type { ITabManager } from './tab-manager.js';
import type { IRefMap } from './ref-map.js';
import type { IUrlBlocker } from './url-blocker.js';
import type { INetworkInterceptor } from './network-interceptor.js';
import type { IStatePersistence } from './state-persistence.js';

export interface IBrowserLifecycle {
  ensureBrowser(): Promise<void>;
  launch(): Promise<void>;
  close(): Promise<void>;
  isHealthy(): Promise<boolean>;
  connectCDP(port?: number): Promise<string>;
  handoff(): Promise<string>;
  resume(): Promise<void>;
  getIsHeaded(): boolean;
  getIsCDP(): boolean;
  recreateContext(): Promise<string | null>;
}

export class BrowserLifecycle implements IBrowserLifecycle {
  constructor(
    private state: SharedState,
    private tabs: ITabManager,
    private refs: IRefMap,
    private urlBlocker: IUrlBlocker,
    private networkInterceptor: INetworkInterceptor,
    private persistence: IStatePersistence,
    private wirePageEventsFn: (page: Page) => void,
  ) {}

  async ensureBrowser(): Promise<void> {
    if (extensionServer.isConnected()) {
      if (!this.state._loggedExtension) {
        const tab = extensionServer.getSessionTab();
        console.error(`[pilot] Extension connected ✓ — using your real Chrome${tab ? ` (tab ${tab})` : ''}`);
        this.state._loggedExtension = true;
        this.state._loggedHeaded = false;
      }
      return;
    }
    if (this.state.browser && this.state.browser.isConnected()) return;

    // Wait briefly for extension to connect before falling back to Chromium.
    if (!this.state._waitedForExtension) {
      this.state._waitedForExtension = true;
      console.error('[pilot] Waiting for Chrome extension to connect (5s)...');
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (extensionServer.isConnected()) {
          const tab = extensionServer.getSessionTab();
          console.error(`[pilot] Extension connected ✓ — using your real Chrome${tab ? ` (tab ${tab})` : ''}`);
          this.state._loggedExtension = true;
          return;
        }
      }
    }

    if (!this.state._loggedHeaded) {
      console.error('[pilot] Extension not connected — running in headed Chromium mode');
      console.error('[pilot] For best experience, install the extension: npx pilot-mcp --install-extension');
      this.state._loggedHeaded = true;
    }
    await this.launch();
  }

  async launch(): Promise<void> {
    const isLinux = process.platform === 'linux';
    const launchArgs: string[] = isLinux
      ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      : [];

    const headed = process.env.PILOT_HEADLESS !== '1';
    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless: !headed,
      ...(launchArgs.length > 0 ? { args: launchArgs } : {}),
    };

    if (isLinux && process.env.PILOT_CHROMIUM_PATH) {
      launchOptions.executablePath = process.env.PILOT_CHROMIUM_PATH;
    }

    this.state.browser = await chromium.launch(launchOptions);

    this.state.browser.on('disconnected', () => {
      console.error('[pilot] FATAL: Chromium process crashed or was killed.');
      this.state.browser = null;
      this.state.context = null;
      this.state.pages.clear();
    });

    const contextOptions: BrowserContextOptions = {
      viewport: { width: 1280, height: 720 },
    };
    if (this.state.customUserAgent) {
      contextOptions.userAgent = this.state.customUserAgent;
    }
    this.state.context = await this.state.browser.newContext(contextOptions);

    if (Object.keys(this.state.extraHeaders).length > 0) {
      await this.state.context.setExtraHTTPHeaders(this.state.extraHeaders);
    }

    await this.applyAllRoutesFromConfig();

    await this.tabs.newTab();
  }

  async close(): Promise<void> {
    if (this.state.browser) {
      this.state.browser.removeAllListeners('disconnected');
      await Promise.race([
        this.state.browser.close(),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]).catch(() => {});
      this.state.browser = null;
      this.state.context = null;
      this.state.pages.clear();
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.state.browser || !this.state.browser.isConnected()) return false;
    try {
      const page = this.state.pages.get(this.state.activeTabId);
      if (!page) return true;
      await Promise.race([
        page.evaluate('1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  // ─── CDP: Connect to real user Chrome ────────────────────────

  async connectCDP(port: number = 9222): Promise<string> {
    const endpoint = `http://localhost:${port}`;

    let cdpBrowser: Browser;
    try {
      cdpBrowser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `ERROR: Cannot connect to Chrome on port ${port} — ${msg}.\n\nMake sure Chrome is running with:\n  --remote-debugging-port=${port}\n\nExample (macOS):\n  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=${port}`;
    }

    // Grab the first existing context (real Chrome always has one)
    const contexts = cdpBrowser.contexts();
    const newContext = contexts[0] ?? await cdpBrowser.newContext();

    const oldBrowser = this.state.browser;

    this.state.browser = cdpBrowser;
    this.state.context = newContext;
    this.state.pages.clear();
    this.state.isHeaded = true;
    this.state.isCDP = true;

    this.state.browser.on('disconnected', () => {
      console.error('[pilot] CDP browser disconnected.');
      this.state.browser = null;
      this.state.context = null;
      this.state.pages.clear();
      this.state.isCDP = false;
    });

    // Map existing pages
    const existingPages = newContext.pages();
    if (existingPages.length > 0) {
      for (const page of existingPages) {
        const id = this.state.nextTabId++;
        this.state.pages.set(id, page);
        this.wirePageEventsFn(page);
      }
      this.state.activeTabId = [...this.state.pages.keys()][existingPages.length - 1];
    } else {
      await this.tabs.newTab();
    }

    this.refs.clearRefs();

    if (oldBrowser) {
      oldBrowser.removeAllListeners('disconnected');
      oldBrowser.close().catch(() => {});
    }

    const pageCount = this.state.pages.size;
    const currentUrl = this.tabs.getCurrentUrl();
    return `Connected to real Chrome on port ${port}. ${pageCount} tab(s) found. Active page: ${currentUrl}\nAll automation now runs in your real Chrome profile — Cloudflare will see a real user.`;
  }

  getIsCDP(): boolean {
    return this.state.isCDP;
  }

  // ─── Handoff: Headless → Headed ─────────────────────────────

  async handoff(): Promise<string> {
    if (this.state.isHeaded) {
      return `Already in headed mode at ${this.tabs.getCurrentUrl()}`;
    }
    if (!this.state.browser || !this.state.context) {
      throw new Error('Browser not launched');
    }

    const state = await this.persistence.saveState();
    const currentUrl = this.tabs.getCurrentUrl();

    let newBrowser: Browser;
    const isLinux = process.platform === 'linux';
    const handoffArgs = isLinux
      ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      : [];

    const handoffOptions: Parameters<typeof chromium.launch>[0] = {
      headless: false,
      timeout: 15000,
      ...(handoffArgs.length > 0 ? { args: handoffArgs } : {}),
    };

    if (isLinux && process.env.PILOT_CHROMIUM_PATH) {
      handoffOptions.executablePath = process.env.PILOT_CHROMIUM_PATH;
    }

    try {
      newBrowser = await chromium.launch(handoffOptions);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `ERROR: Cannot open headed browser — ${msg}. Headless browser still running.`;
    }

    try {
      const contextOptions: BrowserContextOptions = {
        viewport: { width: 1280, height: 720 },
      };
      if (this.state.customUserAgent) {
        contextOptions.userAgent = this.state.customUserAgent;
      }
      const newContext = await newBrowser.newContext(contextOptions);

      if (Object.keys(this.state.extraHeaders).length > 0) {
        await newContext.setExtraHTTPHeaders(this.state.extraHeaders);
      }

      const oldBrowser = this.state.browser;

      this.state.browser = newBrowser;
      this.state.context = newContext;
      this.state.pages.clear();

      this.state.browser.on('disconnected', () => {
        console.error('[pilot] FATAL: Chromium process crashed or was killed.');
        this.state.browser = null;
        this.state.context = null;
        this.state.pages.clear();
      });

      await this.persistence.restoreState(state);
      this.state.isHeaded = true;

      oldBrowser.removeAllListeners('disconnected');
      oldBrowser.close().catch(() => {});

      return `Headed browser opened at ${currentUrl}. All cookies, tabs, and state preserved.`;
    } catch (err: unknown) {
      await newBrowser.close().catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      return `ERROR: Handoff failed — ${msg}. Headless browser still running.`;
    }
  }

  async resume(): Promise<void> {
    this.refs.clearRefs();
    // Reset failure counter directly on state
    this.state.consecutiveFailures = 0;
  }

  getIsHeaded(): boolean {
    return this.state.isHeaded;
  }

  async recreateContext(): Promise<string | null> {
    if (!this.state.browser || !this.state.context) throw new Error('Browser not launched');

    try {
      const state = await this.persistence.saveState();
      for (const page of this.state.pages.values()) {
        await page.close().catch(() => {});
      }
      this.state.pages.clear();
      await this.state.context.close().catch(() => {});

      const contextOptions: BrowserContextOptions = {
        viewport: { width: 1280, height: 720 },
      };
      if (this.state.customUserAgent) {
        contextOptions.userAgent = this.state.customUserAgent;
      }
      this.state.context = await this.state.browser.newContext(contextOptions);
      if (Object.keys(this.state.extraHeaders).length > 0) {
        await this.state.context.setExtraHTTPHeaders(this.state.extraHeaders);
      }
      await this.persistence.restoreState(state);
      await this.applyAllRoutesFromConfig();
      return null;
    } catch (err: unknown) {
      try {
        this.state.pages.clear();
        if (this.state.context) await this.state.context.close().catch(() => {});
        const contextOptions: BrowserContextOptions = {
          viewport: { width: 1280, height: 720 },
        };
        if (this.state.customUserAgent) {
          contextOptions.userAgent = this.state.customUserAgent;
        }
        this.state.context = await this.state.browser!.newContext(contextOptions);
        await this.tabs.newTab();
        this.refs.clearRefs();
      } catch {}
      return `Context recreation failed: ${err instanceof Error ? err.message : String(err)}. Browser reset to blank tab.`;
    }
  }

  /** Apply both blocker and interceptor routes from their stored configs. */
  private async applyAllRoutesFromConfig(): Promise<void> {
    await this.urlBlocker.applyRoutesFromConfig();
    await this.networkInterceptor.applyRoutesFromConfig();
  }
}
