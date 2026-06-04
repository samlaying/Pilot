/**
 * BrowserConfig — manages extra headers, user agent, and viewport settings.
 */

import type { SharedState } from './shared-state.js';

export interface IBrowserConfig {
  setExtraHeader(name: string, value: string): Promise<void>;
  setUserAgent(ua: string): void;
  getUserAgent(): string | null;
  getContext(): import('playwright').BrowserContext;
  setViewport(width: number, height: number): Promise<void>;
}

export class BrowserConfig implements IBrowserConfig {
  constructor(private state: SharedState) {}

  async setExtraHeader(name: string, value: string): Promise<void> {
    this.state.extraHeaders[name] = value;
    if (this.state.context) {
      await this.state.context.setExtraHTTPHeaders(this.state.extraHeaders);
    }
  }

  setUserAgent(ua: string): void {
    this.state.customUserAgent = ua;
  }

  getUserAgent(): string | null {
    return this.state.customUserAgent;
  }

  getContext(): import('playwright').BrowserContext {
    if (!this.state.context) throw new Error('Browser not launched');
    return this.state.context;
  }

  async setViewport(width: number, height: number): Promise<void> {
    // Requires a live page — delegate to getPage() from tab-manager via facade
    // but we need access to pages here. We'll access state.pages directly.
    const page = this.state.pages.get(this.state.activeTabId);
    if (!page) throw new Error('No active page. Use pilot_navigate first.');
    await page.setViewportSize({ width, height });
  }
}
