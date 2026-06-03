/**
 * Pilot MCP — Background Service Worker (Multiplexer)
 *
 * Connects to the Pilot MCP broker on localhost:3131.
 * Multiple Claude Code sessions share this extension —
 * each session gets its own Chrome tab.
 *
 * Protocol:
 *   Broker → Extension: { id, type, payload, sessionId, tabId }
 *   Extension → Broker: { id, result|error, sessionId }
 */

const WS_URL = 'ws://127.0.0.1:3131';
const RECONNECT_DELAY = 3000;
const KEEPALIVE_INTERVAL = 20000;
const RECONNECT_ALARM = 'pilot-reconnect';
const INTERNAL_URL_RE = /^(chrome|edge|moz)-extension:\/\/|^(chrome|edge):\/\/|^devtools:\/\//i;

let ws = null;
let reconnectTimer = null;
let keepaliveTimer = null;

// sessionId → tabId mapping (managed by session_init/session_close)
const sessionTabs = new Map();
// sessionId → groupId
const sessionGroups = new Map();

const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
let colorIndex = 0;

async function ensureOffscreen() {
  if (!chrome.offscreen?.createDocument) return;

  try {
    if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Keep the Pilot MCP WebSocket connection alive during active browser automation.',
    });
  } catch (err) {
    if (!String(err?.message || err).includes('Only a single offscreen document')) {
      console.warn('[pilot] Could not create offscreen keepalive document:', err);
    }
  }
}

function startReconnectAlarm() {
  if (!chrome.alarms?.create) return;
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
}

function sendKeepalive() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'keepalive', role: 'extension', ts: Date.now() }));
  }
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[pilot] Connected to broker');
    clearTimeout(reconnectTimer);
    updateBadge(true);
    startKeepalive();
    // Identify as extension
    ws.send(JSON.stringify({ type: 'hello', role: 'extension' }));
  };

  ws.onclose = () => {
    console.log('[pilot] Disconnected from broker, reconnecting...');
    ws = null;
    stopKeepalive();
    updateBadge(false);
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
  };

  ws.onerror = () => {};

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    const { id, type, payload = {}, sessionId, tabId } = msg;
    let result, error;

    try {
      result = await handleCommand(type, payload, sessionId, tabId);
    } catch (err) {
      error = err.message || String(err);
    }

    const response = { id, sessionId };
    if (error !== undefined) response.error = error;
    else response.result = result;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  };
}

function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(() => {
    sendKeepalive();
  }, KEEPALIVE_INTERVAL);
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function updateBadge(connected) {
  chrome.action.setBadgeText({ text: connected ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: connected ? '#22c55e' : '#ef4444' });
}

// ─── Command Router ────────────────────────────────────────

async function handleCommand(type, payload, sessionId, tabId) {
  switch (type) {
    // ── Session Management ──
    case 'session_init':
      return await initSession(sessionId);
    case 'session_close':
      return await closeSession(sessionId, tabId);

    // ── Tab Management ──
    case 'tabs':
      return await getTabs();
    case 'new_tab':
      return await newTab(payload.url, sessionId);
    case 'close_tab':
      return await closeTab(payload.tabId);
    case 'switch_tab':
      return await switchTab(payload.tabId, sessionId);

    // ── Navigation (uses session's tab) ──
    case 'navigate':
      return await navigate(payload.url, tabId, sessionId);
    case 'back':
      return await goBack(tabId, sessionId);
    case 'forward':
      return await goForward(tabId, sessionId);
    case 'reload':
      return await doReload(tabId, sessionId);
    case 'get_url':
      return await getUrl(tabId, sessionId);

    // ── Screenshot ──
    case 'screenshot':
      return await screenshot(tabId, sessionId);

    // ── Content Script Commands ──
    case 'snapshot':
    case 'click':
    case 'fill':
    case 'type':
    case 'press':
    case 'scroll':
    case 'hover':
    case 'select_option':
    case 'upload_file':
    case 'wait':
    case 'find':
    case 'page_links':
    case 'page_forms':
    case 'element_state':
    case 'dom_find':
    case 'evaluate':
    case 'page_text':
    case 'page_html':
      return await relayToContent(type, payload, tabId, sessionId);

    case 'click_text':
      return await trustedClickText(payload, tabId, sessionId);

    case 'ping':
      return { pong: true };

    default:
      throw new Error(`Unknown command: ${type}`);
  }
}

// ─── Session Management ────────────────────────────────────

async function initSession(sessionId) {
  // Check if we already have a tab for this session
  if (sessionTabs.has(sessionId)) {
    const existing = await getUsableTab(sessionTabs.get(sessionId));
    if (existing) return { tabId: existing.id };
  }

  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  sessionTabs.set(sessionId, tab.id);

  // Create a tab group for this session (optional — not supported in all browsers)
  if (chrome.tabGroups) {
    try {
      const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
      const color = GROUP_COLORS[colorIndex++ % GROUP_COLORS.length];
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

async function closeSession(sessionId, tabId) {
  const id = tabId || sessionTabs.get(sessionId);
  if (id) {
    try { await chrome.tabs.remove(id); } catch {}
  }
  // Remove group (Chrome auto-removes empty groups)
  sessionGroups.delete(sessionId);
  sessionTabs.delete(sessionId);
  return {};
}

// ─── Tab Helpers ───────────────────────────────────────────

function isInternalUrl(url) {
  return INTERNAL_URL_RE.test(url || '');
}

async function getUsableTab(tabId) {
  if (!tabId) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.id || isInternalUrl(tab.url)) return null;
    return tab;
  } catch {
    return null;
  }
}

async function getActiveContentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs.find(t => t?.id && !isInternalUrl(t.url)) || null;
}

async function resolveTab(tabId, sessionId) {
  const candidates = [tabId, sessionId ? sessionTabs.get(sessionId) : undefined];
  for (const candidate of candidates) {
    const tab = await getUsableTab(candidate);
    if (tab?.id) {
      if (sessionId) sessionTabs.set(sessionId, tab.id);
      return tab.id;
    }
  }

  const active = await getActiveContentTab();
  if (active?.id) {
    if (sessionId) sessionTabs.set(sessionId, active.id);
    return active.id;
  }

  if (sessionId) {
    const created = await initSession(sessionId);
    return created.tabId;
  }

  throw new Error('No tab assigned to this session — call session_init first');
}

async function getTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.map(t => ({
    tabId: t.id,
    url: t.url,
    title: t.title,
    active: t.active,
  }));
}

async function newTab(url, sessionId) {
  const tab = await chrome.tabs.create({ url: url || 'about:blank', active: false });
  await waitForTabLoad(tab.id);
  // Add to session's group and update active tab
  if (sessionId) {
    sessionTabs.set(sessionId, tab.id);
    const groupId = sessionGroups.get(sessionId);
    if (groupId) {
      try { await chrome.tabs.group({ tabIds: [tab.id], groupId }); } catch {}
    }
  }
  return { tabId: tab.id };
}

async function closeTab(tabId) {
  await chrome.tabs.remove(tabId);
  // Remove from session mapping
  for (const [sid, tid] of sessionTabs) {
    if (tid === tabId) sessionTabs.delete(sid);
  }
  return {};
}

async function switchTab(tabId, sessionId) {
  const tab = await getUsableTab(tabId);
  if (!tab?.id) throw new Error(`No such tab: ${tabId}`);
  await chrome.tabs.update(tabId, { active: true });
  if (sessionId) sessionTabs.set(sessionId, tabId);
  return { tabId };
}

// ─── Navigation ────────────────────────────────────────────

async function navigate(url, tabId, sessionId) {
  const id = await resolveTab(tabId, sessionId);
  await chrome.tabs.update(id, { url });
  await waitForTabLoad(id);
  const updated = await chrome.tabs.get(id);
  return { url: updated.url, tabId: id };
}

async function goBack(tabId, sessionId) {
  const id = await resolveTab(tabId, sessionId);
  await chrome.tabs.goBack(id);
  await waitForTabLoad(id);
  const updated = await chrome.tabs.get(id);
  return { url: updated.url, tabId: id };
}

async function goForward(tabId, sessionId) {
  const id = await resolveTab(tabId, sessionId);
  await chrome.tabs.goForward(id);
  await waitForTabLoad(id);
  const updated = await chrome.tabs.get(id);
  return { url: updated.url, tabId: id };
}

async function doReload(tabId, sessionId) {
  const id = await resolveTab(tabId, sessionId);
  await chrome.tabs.reload(id);
  await waitForTabLoad(id);
  const updated = await chrome.tabs.get(id);
  return { url: updated.url, tabId: id };
}

async function getUrl(tabId, sessionId) {
  const id = await resolveTab(tabId, sessionId);
  const tab = await chrome.tabs.get(id);
  return { url: tab.url, tabId: id };
}

function waitForTabLoad(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.webNavigation.onCompleted.removeListener(listener);
      resolve();
    }, timeout);

    function listener(details) {
      if (details.tabId === tabId && details.frameId === 0) {
        clearTimeout(timer);
        chrome.webNavigation.onCompleted.removeListener(listener);
        resolve();
      }
    }
    chrome.webNavigation.onCompleted.addListener(listener);
  });
}

// ─── Screenshot ────────────────────────────────────────────

async function screenshot(tabId, sessionId) {
  // Focus the tab briefly to capture
  const id = await resolveTab(tabId, sessionId);
  await chrome.tabs.update(id, { active: true });
  await new Promise(r => setTimeout(r, 100));
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  return { data: base64, mimeType: 'image/png' };
}

// ─── Content Script Relay ──────────────────────────────────

async function relayToContent(type, payload, tabId, sessionId) {
  const id = await resolveTab(tabId, sessionId);

  // Ensure content script is injected
  try {
    await chrome.scripting.executeScript({
      target: { tabId: id },
      files: ['content.js'],
    });
  } catch {
    // Already injected or can't inject
  }

  const results = await chrome.tabs.sendMessage(id, { type, payload });
  if (results?.error) throw new Error(results.error);
  const result = results?.result ?? results;
  return result && typeof result === 'object' && !Array.isArray(result)
    ? { ...result, tabId: id }
    : result;
}

async function trustedClickText(payload, tabId, sessionId) {
  const id = await resolveTab(tabId, sessionId);
  const target = await relayToContent('find_text_rect', payload, id, sessionId);
  await dispatchTrustedClick(id, target.x, target.y);
  return { ...target, trusted: true, tabId: id };
}

async function dispatchTrustedClick(tabId, x, y) {
  if (!chrome.debugger?.attach) {
    throw new Error('Trusted click requires the Chrome debugger permission');
  }

  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  } finally {
    try { await chrome.debugger.detach(target); } catch {}
  }
}

// ─── Internal Messages (from popup) ───────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'offscreen_keepalive') {
    connect();
    sendKeepalive();
    sendResponse({ ok: true, connected: ws && ws.readyState === WebSocket.OPEN });
    return false;
  }

  if (msg.type === 'ping') {
    sendResponse({
      pong: ws && ws.readyState === WebSocket.OPEN,
      sessions: sessionTabs.size,
    });
  }
  return false;
});

// Keep session routing in sync when the user manually changes Chrome tabs.
if (chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
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
  chrome.tabs.onRemoved.addListener((tabId) => {
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
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== RECONNECT_ALARM) return;
    ensureOffscreen();
    connect();
    sendKeepalive();
  });
}
