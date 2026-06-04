/**
 * UrlBlocker — manages URL block patterns and their route handlers.
 */

import type { Route } from 'playwright';
import type { SharedState } from './shared-state.js';

export interface IUrlBlocker {
  addBlockPattern(pattern: string): Promise<void>;
  clearBlockPatterns(): Promise<void>;
  getBlockPatterns(): string[];
  /** Re-apply all stored block/intercept routes to a fresh context. */
  applyRoutesFromConfig(): Promise<void>;
}

export class UrlBlocker implements IUrlBlocker {
  constructor(private state: SharedState) {}

  async addBlockPattern(pattern: string): Promise<void> {
    if (this.state.context && this.state.blockHandlers.has(pattern)) {
      await this.state.context.unroute(pattern, this.state.blockHandlers.get(pattern)!).catch(() => {});
      this.state.blockHandlers.delete(pattern);
    }
    this.state.blockPatterns.add(pattern);
    if (this.state.context) {
      const handler = (route: Route) => route.abort();
      this.state.blockHandlers.set(pattern, handler);
      await this.state.context.route(pattern, handler);
    }
  }

  async clearBlockPatterns(): Promise<void> {
    if (this.state.context) {
      for (const [pattern, handler] of this.state.blockHandlers) {
        await this.state.context.unroute(pattern, handler).catch(() => {});
      }
    }
    this.state.blockHandlers.clear();
    this.state.blockPatterns.clear();
  }

  getBlockPatterns(): string[] {
    return [...this.state.blockPatterns];
  }

  async applyRoutesFromConfig(): Promise<void> {
    if (!this.state.context) return;
    this.state.blockHandlers.clear();
    for (const pattern of this.state.blockPatterns) {
      const handler = (route: Route) => route.abort();
      this.state.blockHandlers.set(pattern, handler);
      await this.state.context.route(pattern, handler);
    }
  }
}
