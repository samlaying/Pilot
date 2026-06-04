/**
 * SharedState — single mutable state container for all browser-manager sub-modules.
 *
 * Every sub-module receives a SharedState reference via constructor injection.
 * Sub-modules never import each other; they only read/write SharedState fields.
 */

import type {
  Browser,
  BrowserContext,
  Page,
  Frame,
  Route,
  Cookie,
} from 'playwright';
import type { RefEntry } from '../types.js';
import * as os from 'os';
import * as path from 'path';

/** Browser state snapshot for save/restore operations. */
export interface BrowserState {
  cookies: Cookie[];
  pages: Array<{
    url: string;
    isActive: boolean;
    storage: { localStorage: Record<string, string>; sessionStorage: Record<string, string> } | null;
  }>;
}

/** File-system paths for state persistence. */
export const STATE_DIR_PATH = path.join(os.homedir(), '.pilot');
export const STATE_FILE_PATH = path.join(STATE_DIR_PATH, 'state.json');

export class SharedState {
  // ─── Browser Core ──────────────────────────────────────────
  browser: Browser | null = null;
  context: BrowserContext | null = null;

  // ─── Tab Management ───────────────────────────────────────
  pages: Map<number, Page> = new Map();
  activeTabId: number = 0;
  nextTabId: number = 1;

  // ─── Browser Config ───────────────────────────────────────
  extraHeaders: Record<string, string> = {};
  customUserAgent: string | null = null;

  // ─── Ref Map ──────────────────────────────────────────────
  refMap: Map<string, RefEntry> = new Map();

  // ─── Snapshot Diffing ─────────────────────────────────────
  lastSnapshot: string | null = null;

  // ─── Iframe Frame Tracking ────────────────────────────────
  activeFrame: Frame | null = null;

  // ─── Dialog Handling ──────────────────────────────────────
  dialogAutoAccept: boolean = true;
  dialogPromptText: string | null = null;

  // ─── Failure Tracking ─────────────────────────────────────
  consecutiveFailures: number = 0;

  // ─── URL Blocking ─────────────────────────────────────────
  blockPatterns: Set<string> = new Set();
  blockHandlers: Map<string, (route: Route) => void> = new Map();

  // ─── Network Intercepts ───────────────────────────────────
  interceptConfigs: Map<
    string,
    { status?: number; body?: string; headers?: Record<string, string>; contentType?: string }
  > = new Map();
  interceptHandlers: Map<string, (route: Route) => void> = new Map();

  // ─── Extension Bridge ─────────────────────────────────────
  _extActiveTab: number | undefined;

  // ─── Browser Lifecycle Flags ──────────────────────────────
  _waitedForExtension: boolean = false;
  _loggedExtension: boolean = false;
  _loggedHeaded: boolean = false;
  isHeaded: boolean = false;
  isCDP: boolean = false;
}
