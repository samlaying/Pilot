/**
 * Pilot MCP — Tab CRUD Operations
 *
 * Helpers for checking, listing, creating, closing,
 * and switching Chrome tabs.
 */

import { sessionTabs, sessionGroups, initSession, resolveSessionTab } from './sessions';

const INTERNAL_URL_RE = /^(chrome|edge|moz)-extension:\/\/|^(chrome|edge):\/\/|^devtools:\/\//i;

// ─── Helpers ───────────────────────────────────────────────

export function isInternalUrl(url: string | undefined): boolean {
  return INTERNAL_URL_RE.test(url || '');
}

export async function getUsableTab(tabId: number | undefined): Promise<chrome.tabs.Tab | null> {
  if (!tabId) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.id || isInternalUrl(tab.url)) return null;
    return tab;
  } catch {
    return null;
  }
}

// ─── Tab Command Handlers ──────────────────────────────────

export async function handleGetTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.map(t => ({
    tabId: t.id,
    url: t.url,
    title: t.title,
    active: t.active,
  }));
}

export async function handleNewTab(url: string | undefined, sessionId: string | undefined) {
  const tab = await chrome.tabs.create({ url: url || 'about:blank', active: false });
  await waitForTabLoad(tab.id!);
  // Add to session's group and update active tab
  if (sessionId) {
    sessionTabs.set(sessionId, tab.id!);
    const groupId = sessionGroups.get(sessionId);
    if (groupId) {
      try { await chrome.tabs.group({ tabIds: [tab.id!], groupId }); } catch {}
    }
  }
  return { tabId: tab.id };
}

export async function handleCloseTab(tabId: number) {
  await chrome.tabs.remove(tabId);
  // Remove from session mapping
  for (const [sid, tid] of sessionTabs) {
    if (tid === tabId) sessionTabs.delete(sid);
  }
  return {};
}

export async function handleSwitchTab(tabId: number, sessionId: string | undefined) {
  const tab = await getUsableTab(tabId);
  if (!tab?.id) throw new Error(`No such tab: ${tabId}`);
  await chrome.tabs.update(tabId, { active: true });
  if (sessionId) sessionTabs.set(sessionId, tabId);
  return { tabId };
}

// ─── Tab Load Wait ─────────────────────────────────────────

export function waitForTabLoad(tabId: number, timeout = 15000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.webNavigation.onCompleted.removeListener(listener);
      resolve();
    }, timeout);

    function listener(details: chrome.webNavigation.WebNavigationFramedCallbackDetails) {
      if (details.tabId === tabId && details.frameId === 0) {
        clearTimeout(timer);
        chrome.webNavigation.onCompleted.removeListener(listener);
        resolve();
      }
    }
    chrome.webNavigation.onCompleted.addListener(listener);
  });
}
