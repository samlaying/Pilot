/**
 * Pilot MCP — WebSocket Connection Lifecycle
 *
 * Manages the WebSocket connection to the Pilot MCP broker,
 * including reconnection, keepalive, and badge updates.
 */

import type { CommandMessage, CommandResponse, KeepaliveMessage, HelloMessage } from './types';
import { handleCommand } from './commands';

const WS_URL = 'ws://127.0.0.1:3131';
const RECONNECT_DELAY = 3000;
const KEEPALIVE_INTERVAL = 20000;
const RECONNECT_ALARM = 'pilot-reconnect';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

// ─── Keepalive ─────────────────────────────────────────────

function sendKeepalive() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const msg: KeepaliveMessage = { type: 'keepalive', role: 'extension', ts: Date.now() };
    ws.send(JSON.stringify(msg));
  }
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

// ─── Badge ─────────────────────────────────────────────────

function updateBadge(connected: boolean) {
  chrome.action.setBadgeText({ text: connected ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: connected ? '#22c55e' : '#ef4444' });
}

// ─── Connect ───────────────────────────────────────────────

export function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[pilot] Connected to broker');
    clearTimeout(reconnectTimer as any);
    updateBadge(true);
    startKeepalive();
    const hello: HelloMessage = { type: 'hello', role: 'extension' };
    ws!.send(JSON.stringify(hello));
  };

  ws.onclose = () => {
    console.log('[pilot] Disconnected from broker, reconnecting...');
    ws = null;
    stopKeepalive();
    updateBadge(false);
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
  };

  ws.onerror = () => {};

  ws.onmessage = async (event: MessageEvent) => {
    let msg: CommandMessage;
    try { msg = JSON.parse(event.data); } catch { return; }

    const { id, type, payload = {}, sessionId, tabId } = msg;
    let result: any, error: string | undefined;

    try {
      result = await handleCommand(type, payload, sessionId, tabId);
    } catch (err: any) {
      error = err.message || String(err);
    }

    const response: CommandResponse = { id, sessionId };
    if (error !== undefined) response.error = error;
    else response.result = result;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  };
}

// ─── Alarm-based reconnection ──────────────────────────────

export function startReconnectAlarm() {
  if (!chrome.alarms?.create) return;
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
}

export { sendKeepalive, RECONNECT_ALARM };

// ─── Public helpers ────────────────────────────────────────

export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}
