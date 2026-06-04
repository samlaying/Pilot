/**
 * Pilot MCP — Background Service Worker Entry Point
 *
 * Wires up startup, event listeners, and message handlers.
 * esbuild bundles all modules in extension/src/background/
 * into a single background.js service worker.
 */

import { connect, startReconnectAlarm, sendKeepalive, RECONNECT_ALARM, isConnected } from './connection';
import { sessionTabs, sessionGroups } from './sessions';
import { getUsableTab } from './tabs';

// ─── Offscreen Keepalive Document ──────────────────────────

async function ensureOffscreen() {
  if (!chrome.offscreen?.createDocument) return;

  try {
    if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Keep the Pilot MCP WebSocket connection alive during active browser automation.',
    });
  } catch (err: any) {
    if (!String(err?.message || err).includes('Only a single offscreen document')) {
      console.warn('[pilot] Could not create offscreen keepalive document:', err);
    }
  }
}

// ─── Internal Messages (from popup / offscreen) ────────────

chrome.runtime.onMessage.addListener((msg: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (msg.type === 'offscreen_keepalive') {
    connect();
    sendKeepalive();
    sendResponse({ ok: true, connected: isConnected() });
    return false;
  }

  if (msg.type === 'ping') {
    sendResponse({
      pong: isConnected(),
      sessions: sessionTabs.size,
    });
  }
  return false;
});

// ─── Tab Event Listeners ───────────────────────────────────

// Keep session routing in sync when the user manually changes Chrome tabs.
if (chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener(async ({ tabId }: chrome.tabs.OnActivatedInfo) => {
    const tab = await getUsableTab(tabId);
    if (!tab?.id) return;
    for (const [sessionId, groupId] of sessionGroups) {
      if (tab.groupId === groupId) {
        sessionTabs.set(sessionId, tab.id);
        return;
      }
    }
  });
}

if (chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId: number) => {
    for (const [sessionId, mappedTabId] of sessionTabs) {
      if (mappedTabId === tabId) sessionTabs.delete(sessionId);
    }
  });
}

// ─── Startup ───────────────────────────────────────────────

ensureOffscreen();
startReconnectAlarm();
connect();

chrome.runtime.onStartup.addListener(() => {
  ensureOffscreen();
  startReconnectAlarm();
  connect();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureOffscreen();
  startReconnectAlarm();
  connect();
});

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
    if (alarm.name !== RECONNECT_ALARM) return;
    ensureOffscreen();
    connect();
    sendKeepalive();
  });
}
