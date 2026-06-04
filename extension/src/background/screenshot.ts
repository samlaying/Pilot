/**
 * Pilot MCP — Screenshot Command
 *
 * Captures a visible tab as a PNG base64 screenshot.
 */

import { resolveSessionTab } from './sessions';

export async function screenshot(tabId: number | undefined, sessionId: string | undefined) {
  const id = await resolveSessionTab(tabId, sessionId);
  await chrome.tabs.update(id, { active: true });
  await new Promise(r => setTimeout(r, 100));
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  return { data: base64, mimeType: 'image/png' };
}
