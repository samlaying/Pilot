// Pilot MCP — Popup UI
// Displays connection status by pinging the background service worker.

interface PingResponse {
  pong: boolean;
  sessions: number;
}

const dot = document.getElementById('dot') as HTMLDivElement | null;
const statusText = document.getElementById('status-text') as HTMLSpanElement | null;
const hint = document.getElementById('hint') as HTMLParagraphElement | null;

function setConnected(): void {
  if (dot) dot.className = 'pilot-dot pilot-dot--connected';
  if (statusText) statusText.textContent = 'Connected to Pilot MCP';
  if (hint) hint.textContent = 'Claude Code can now control this browser.';
}

function setDisconnected(): void {
  if (dot) dot.className = 'pilot-dot pilot-dot--disconnected';
  if (statusText) statusText.textContent = 'Not connected';
  if (hint) hint.textContent = 'Start Pilot MCP in Claude Code, then reload this popup.';
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ type: 'ping' }, (response: PingResponse) => {
    if (chrome.runtime.lastError || !response?.pong) {
      setDisconnected();
    } else {
      setConnected();
    }
  });
});
