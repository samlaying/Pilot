/**
 * BrowserManager facade — preserves the exact same public API as the original
 * browser-manager.ts, but delegates every method to sub-modules.
 *
 * Sub-modules receive a shared SharedState instance via constructor injection
 * and never import each other directly.
 */

import type { Page, Frame, Locator, Route, Cookie, BrowserContext } from 'playwright';
import type { ExtensionServer } from '../extension-server.js';
import type { RefEntry } from '../types.js';

import { SharedState } from './shared-state.js';
import type { BrowserState } from './shared-state.js';

import { ExtensionBridge } from './extension-bridge.js';
import { FailureTracker } from './failure-tracker.js';
import { SnapshotState } from './snapshot-state.js';
import { DialogConfig } from './dialog-config.js';
import { RefMap } from './ref-map.js';
import { BrowserConfig } from './browser-config.js';
import { UrlBlocker } from './url-blocker.js';
import { NetworkInterceptor } from './network-interceptor.js';
import { TabManager } from './tab-manager.js';
import { FrameManager } from './frame-manager.js';
import { BrowserLifecycle } from './browser-lifecycle.js';
import { StatePersistence } from './state-persistence.js';
import { wirePageEvents } from './page-event-wiring.js';

export class BrowserManager {
  private state = new SharedState();

  // Sub-modules (created in dependency order)
  private ext: ExtensionBridge;
  private failures: FailureTracker;
  private snapshots: SnapshotState;
  private dialogs: DialogConfig;
  private refs: RefMap;
  private config: BrowserConfig;
  private urlBlocker: UrlBlocker;
  private networkInterceptor: NetworkInterceptor;
  private tabs: TabManager;
  private frames: FrameManager;
  private lifecycle: BrowserLifecycle;
  private persistence: StatePersistence;

  // Bound wirePageEvents wrapper that closes over this.state and this.refs
  private wiredPageEvents: (page: Page) => void;

  constructor() {
    // Wire page events needs state + clearRefs callback
    this.wiredPageEvents = (page: Page) => {
      wirePageEvents(page, this.state, () => this.refs.clearRefs());
    };

    this.ext = new ExtensionBridge(this.state);
    this.failures = new FailureTracker(this.state);
    this.snapshots = new SnapshotState(this.state);
    this.dialogs = new DialogConfig(this.state);
    this.refs = new RefMap(this.state);
    this.config = new BrowserConfig(this.state);
    this.urlBlocker = new UrlBlocker(this.state);
    this.networkInterceptor = new NetworkInterceptor(this.state);

    // TabManager needs wirePageEvents + clearRefs callbacks
    this.tabs = new TabManager(
      this.state,
      this.wiredPageEvents,
      () => this.refs.clearRefs(),
    );

    // FrameManager needs getPage + clearRefs callbacks
    this.frames = new FrameManager(
      this.state,
      () => this.tabs.getPage(),
      () => this.refs.clearRefs(),
    );

    // StatePersistence needs wirePageEvents + clearRefs + newTab callbacks
    this.persistence = new StatePersistence(
      this.state,
      this.wiredPageEvents,
      () => this.refs.clearRefs(),
      (url?: string) => this.tabs.newTab(url),
    );

    // BrowserLifecycle needs tabs, refs, urlBlocker, networkInterceptor, persistence, wirePageEvents
    this.lifecycle = new BrowserLifecycle(
      this.state,
      this.tabs,
      this.refs,
      this.urlBlocker,
      this.networkInterceptor,
      this.persistence,
      this.wiredPageEvents,
    );
  }

  // ─── Extension Bridge ─────────────────────────────────────
  getExtension(): ExtensionServer | null {
    return this.ext.getExtension();
  }

  async extSend<T = unknown>(type: string, payload?: Record<string, unknown>): Promise<T> {
    return this.ext.extSend<T>(type, payload);
  }

  setExtActiveTab(tabId: number): void {
    this.ext.setExtActiveTab(tabId);
  }

  getExtActiveTab(): number | undefined {
    return this.ext.getExtActiveTab();
  }

  // ─── Browser Lifecycle ────────────────────────────────────
  async ensureBrowser(): Promise<void> {
    return this.lifecycle.ensureBrowser();
  }

  async launch(): Promise<void> {
    return this.lifecycle.launch();
  }

  async close(): Promise<void> {
    return this.lifecycle.close();
  }

  async isHealthy(): Promise<boolean> {
    return this.lifecycle.isHealthy();
  }

  async connectCDP(port: number = 9222): Promise<string> {
    return this.lifecycle.connectCDP(port);
  }

  getIsCDP(): boolean {
    return this.lifecycle.getIsCDP();
  }

  async handoff(): Promise<string> {
    return this.lifecycle.handoff();
  }

  async resume(): Promise<void> {
    return this.lifecycle.resume();
  }

  getIsHeaded(): boolean {
    return this.lifecycle.getIsHeaded();
  }

  async recreateContext(): Promise<string | null> {
    return this.lifecycle.recreateContext();
  }

  // ─── Tab Management ───────────────────────────────────────
  async newTab(url?: string): Promise<number> {
    return this.tabs.newTab(url);
  }

  async closeTab(id?: number): Promise<void> {
    return this.tabs.closeTab(id);
  }

  switchTab(id: number): void {
    this.tabs.switchTab(id);
  }

  getTabCount(): number {
    return this.tabs.getTabCount();
  }

  async getTabListWithTitles(): Promise<Array<{ id: number; url: string; title: string; active: boolean }>> {
    return this.tabs.getTabListWithTitles();
  }

  // ─── Page Access ──────────────────────────────────────────
  getPage(): Page {
    return this.tabs.getPage();
  }

  getCurrentUrl(): string {
    return this.tabs.getCurrentUrl();
  }

  // ─── Ref Map ──────────────────────────────────────────────
  setRefMap(refs: Map<string, RefEntry>) {
    this.refs.setRefMap(refs);
  }

  clearRefs() {
    this.refs.clearRefs();
  }

  async resolveRef(selector: string): Promise<{ locator: Locator } | { selector: string }> {
    return this.refs.resolveRef(selector);
  }

  getRefRole(selector: string): string | null {
    return this.refs.getRefRole(selector);
  }

  getRefCount(): number {
    return this.refs.getRefCount();
  }

  addSingleRef(locator: Locator, role: string, name: string): string {
    return this.refs.addSingleRef(locator, role, name);
  }

  // ─── Iframe Frames ───────────────────────────────────────
  getActiveFrame(): Frame {
    return this.frames.getActiveFrame();
  }

  setActiveFrame(frame: Frame | null): void {
    this.frames.setActiveFrame(frame);
  }

  async listFrames(): Promise<Array<{ index: number; url: string; name: string; isMain: boolean }>> {
    return this.frames.listFrames();
  }

  selectFrameByIndex(index: number): Frame {
    return this.frames.selectFrameByIndex(index);
  }

  selectFrameByName(name: string): Frame {
    return this.frames.selectFrameByName(name);
  }

  resetFrame(): void {
    this.frames.resetFrame();
  }

  // ─── Snapshot Diffing ─────────────────────────────────────
  setLastSnapshot(text: string | null) {
    this.snapshots.setLastSnapshot(text);
  }

  getLastSnapshot(): string | null {
    return this.snapshots.getLastSnapshot();
  }

  // ─── Dialog Control ───────────────────────────────────────
  setDialogAutoAccept(accept: boolean) {
    this.dialogs.setDialogAutoAccept(accept);
  }

  getDialogAutoAccept(): boolean {
    return this.dialogs.getDialogAutoAccept();
  }

  setDialogPromptText(text: string | null) {
    this.dialogs.setDialogPromptText(text);
  }

  getDialogPromptText(): string | null {
    return this.dialogs.getDialogPromptText();
  }

  // ─── Viewport ──────────────────────────────────────────────
  async setViewport(width: number, height: number) {
    await this.config.setViewport(width, height);
  }

  // ─── Extra Headers ─────────────────────────────────────────
  async setExtraHeader(name: string, value: string) {
    await this.config.setExtraHeader(name, value);
  }

  // ─── User Agent ────────────────────────────────────────────
  setUserAgent(ua: string) {
    this.config.setUserAgent(ua);
  }

  getUserAgent(): string | null {
    return this.config.getUserAgent();
  }

  // ─── Context Access ────────────────────────────────────────
  getContext(): BrowserContext {
    return this.config.getContext();
  }

  // ─── State Save/Restore ───────────────────────────────────
  async saveState(): Promise<BrowserState> {
    return this.persistence.saveState();
  }

  async restoreState(state: BrowserState): Promise<void> {
    return this.persistence.restoreState(state);
  }

  // ─── Disk Persistence ─────────────────────────────────────
  async persistState(): Promise<void> {
    return this.persistence.persistState();
  }

  async clearPersistedState(): Promise<void> {
    return this.persistence.clearPersistedState();
  }

  // ─── Session Save/Load ────────────────────────────────────
  async saveSessionToFile(filePath: string): Promise<number> {
    return this.persistence.saveSessionToFile(filePath);
  }

  async loadSessionFromFile(filePath: string): Promise<number> {
    return this.persistence.loadSessionFromFile(filePath);
  }

  async clearSession(): Promise<void> {
    return this.persistence.clearSession();
  }

  // ─── Failure Tracking ─────────────────────────────────────
  incrementFailures(): void {
    this.failures.incrementFailures();
  }

  resetFailures(): void {
    this.failures.resetFailures();
  }

  getFailureHint(): string | null {
    return this.failures.getFailureHint();
  }

  // ─── URL Blocking ─────────────────────────────────────────
  async addBlockPattern(pattern: string): Promise<void> {
    return this.urlBlocker.addBlockPattern(pattern);
  }

  async clearBlockPatterns(): Promise<void> {
    return this.urlBlocker.clearBlockPatterns();
  }

  getBlockPatterns(): string[] {
    return this.urlBlocker.getBlockPatterns();
  }

  // ─── Network Intercepts ────────────────────────────────────
  async addIntercept(
    pattern: string,
    response: { status?: number; body?: string; headers?: Record<string, string>; contentType?: string },
  ): Promise<void> {
    return this.networkInterceptor.addIntercept(pattern, response);
  }

  async clearIntercepts(): Promise<void> {
    return this.networkInterceptor.clearIntercepts();
  }

  getIntercepts(): Array<{ pattern: string; status: number }> {
    return this.networkInterceptor.getIntercepts();
  }
}
