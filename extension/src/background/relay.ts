/**
 * Pilot MCP — Content Script Relay
 *
 * Sends commands to the content script injected into
 * the session's active tab.
 */

import { resolveSessionTab } from './sessions';

export async function relayToContent(
  type: string,
  payload: Record<string, any>,
  tabId: number | undefined,
  sessionId: string | undefined
) {
  const id = await resolveSessionTab(tabId, sessionId);

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
