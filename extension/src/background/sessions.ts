/**
 * Pilot MCP — Session Management
 *
 * Tracks which Chrome tab belongs to which Pilot session.
 * Each session gets a colour-coded tab group.
 */

import type { SessionTabMap, SessionGroupMap } from './types';
import { getUsableTab } from './tabs';

const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
let colorIndex = 0;

/** sessionId → tabId */
export const sessionTabs: SessionTabMap = new Map();
/** sessionId → groupId */
export const sessionGroups: SessionGroupMap = new Map();

// ─── Session Lifecycle ─────────────────────────────────────

export async function initSession(sessionId: string) {
  // Check if we already have a tab for this session
  if (sessionTabs.has(sessionId)) {
    const existing = await getUsableTab(sessionTabs.get(sessionId)!);
    if (existing) return { tabId: existing.id };
  }

  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  sessionTabs.set(sessionId, tab.id!);

  // Create a tab group for this session (optional — not supported in all browsers)
  if (chrome.tabGroups) {
    try {
      const groupId = await chrome.tabs.group({ tabIds: [tab.id!] });
      const color = GROUP_COLORS[colorIndex++ % GROUP_COLORS.length] as `${chrome.tabGroups.Color}`;
      await chrome.tabGroups.update(groupId, {
        title: `✈️ ${sessionId.slice(0, 6)}`,
        color,
        collapsed: false,
      });
      sessionGroups.set(sessionId, groupId);
      console.log(`[pilot] Session ${sessionId.slice(0, 8)} → tab ${tab.id} (group ${color})`);
    } catch (err) {
      console.warn('[pilot] Could not create tab group:', err);
    }
  }

  return { tabId: tab.id };
}

export async function closeSession(sessionId: string, tabId?: number) {
  const id = tabId || sessionTabs.get(sessionId);
  if (id) {
    try { await chrome.tabs.remove(id); } catch {}
  }
  // Remove group (Chrome auto-removes empty groups)
  sessionGroups.delete(sessionId);
  sessionTabs.delete(sessionId);
  return {};
}

// ─── Helper ────────────────────────────────────────────────

/**
 * Resolve the effective tabId for a session, given an optional
 * command-level tabId and sessionId. Updates the session mapping
 * as a side effect.
 */
export async function resolveSessionTab(tabId: number | undefined, sessionId: string | undefined): Promise<number> {
  const candidates = [tabId, sessionId ? sessionTabs.get(sessionId) : undefined];
  for (const candidate of candidates) {
    const tab = await getUsableTab(candidate);
    if (tab?.id) {
      if (sessionId) sessionTabs.set(sessionId, tab.id);
      return tab.id;
    }
  }

  // Fall back to active content tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const INTERNAL_URL_RE = /^(chrome|edge|moz)-extension:\/\/|^(chrome|edge):\/\/|^devtools:\/\//i;
  const active = tabs.find(t => t?.id && !INTERNAL_URL_RE.test(t.url || ''));
  if (active?.id) {
    if (sessionId) sessionTabs.set(sessionId, active.id);
    return active.id;
  }

  // Last resort: create a new session tab
  if (sessionId) {
    const created = await initSession(sessionId);
    return created.tabId!;
  }

  throw new Error('No tab assigned to this session — call session_init first');
}
