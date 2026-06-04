/**
 * Pilot MCP — Trusted Click (CDP Debugger)
 *
 * Uses the Chrome Debugger Protocol to dispatch
 * trusted mouse events that bypass site restrictions.
 */

import { resolveSessionTab } from './sessions';
import { relayToContent } from './relay';

export async function trustedClickText(
  payload: Record<string, any>,
  tabId: number | undefined,
  sessionId: string | undefined
) {
  const id = await resolveSessionTab(tabId, sessionId);
  const target = await relayToContent('find_text_rect', payload, id, sessionId);
  await dispatchTrustedClick(id, target.x, target.y);
  return { ...target, trusted: true, tabId: id };
}

export async function dispatchTrustedClick(tabId: number, x: number, y: number) {
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
