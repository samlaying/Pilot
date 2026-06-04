// Pilot MCP — Offscreen keepalive document
// Sends periodic heartbeat messages to keep the service worker alive.

const KEEPALIVE_INTERVAL_MS = 20_000;

interface KeepaliveResponse {
  ok: boolean;
  connected: boolean;
}

function keepAlive(): void {
  chrome.runtime.sendMessage({
    type: 'offscreen_keepalive',
    ts: Date.now(),
  }).catch(() => {
    // Swallow errors — background may not be ready yet.
  });
}

keepAlive();
setInterval(keepAlive, KEEPALIVE_INTERVAL_MS);
