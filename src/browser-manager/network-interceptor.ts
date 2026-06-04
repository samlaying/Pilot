/**
 * NetworkInterceptor — manages network intercept configurations and handlers.
 */

import type { Route } from 'playwright';
import type { SharedState } from './shared-state.js';

export interface INetworkInterceptor {
  addIntercept(
    pattern: string,
    response: { status?: number; body?: string; headers?: Record<string, string>; contentType?: string },
  ): Promise<void>;
  clearIntercepts(): Promise<void>;
  getIntercepts(): Array<{ pattern: string; status: number }>;
  /** Re-apply all stored intercept routes to a fresh context. */
  applyRoutesFromConfig(): Promise<void>;
}

export class NetworkInterceptor implements INetworkInterceptor {
  constructor(private state: SharedState) {}

  async addIntercept(
    pattern: string,
    response: { status?: number; body?: string; headers?: Record<string, string>; contentType?: string },
  ): Promise<void> {
    if (this.state.context && this.state.interceptHandlers.has(pattern)) {
      await this.state.context.unroute(pattern, this.state.interceptHandlers.get(pattern)!).catch(() => {});
      this.state.interceptHandlers.delete(pattern);
    }
    this.state.interceptConfigs.set(pattern, response);
    if (this.state.context) {
      const { status = 200, body = '', headers, contentType } = response;
      const handler = (route: Route) => route.fulfill({ status, body, headers, contentType });
      this.state.interceptHandlers.set(pattern, handler);
      await this.state.context.route(pattern, handler);
    }
  }

  async clearIntercepts(): Promise<void> {
    if (this.state.context) {
      for (const [pattern, handler] of this.state.interceptHandlers) {
        await this.state.context.unroute(pattern, handler).catch(() => {});
      }
    }
    this.state.interceptHandlers.clear();
    this.state.interceptConfigs.clear();
  }

  getIntercepts(): Array<{ pattern: string; status: number }> {
    return [...this.state.interceptConfigs.entries()].map(([pattern, cfg]) => ({
      pattern,
      status: cfg.status ?? 200,
    }));
  }

  async applyRoutesFromConfig(): Promise<void> {
    if (!this.state.context) return;
    this.state.interceptHandlers.clear();
    for (const [pattern, cfg] of this.state.interceptConfigs) {
      const { status = 200, body = '', headers, contentType } = cfg;
      const handler = (route: Route) => route.fulfill({ status, body, headers, contentType });
      this.state.interceptHandlers.set(pattern, handler);
      await this.state.context.route(pattern, handler);
    }
  }
}
