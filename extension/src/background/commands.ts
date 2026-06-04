/**
 * Pilot MCP — Command Router
 *
 * Dispatches incoming broker commands to the appropriate
 * handler module based on the command type.
 */

import { initSession, closeSession } from './sessions';
import { handleGetTabs, handleNewTab, handleCloseTab, handleSwitchTab } from './tabs';
import { navigate, goBack, goForward, doReload, getUrl } from './navigation';
import { screenshot } from './screenshot';
import { relayToContent } from './relay';
import { trustedClickText } from './trusted-click';

// Content script command types that are relayed directly
const CONTENT_COMMANDS = new Set([
  'snapshot',
  'click',
  'fill',
  'type',
  'press',
  'scroll',
  'hover',
  'select_option',
  'upload_file',
  'wait',
  'find',
  'page_links',
  'page_forms',
  'element_state',
  'dom_find',
  'evaluate',
  'page_text',
  'page_html',
]);

export async function handleCommand(
  type: string,
  payload: Record<string, any>,
  sessionId: string,
  tabId?: number
): Promise<any> {
  switch (type) {
    // ── Session Management ──
    case 'session_init':
      return await initSession(sessionId);
    case 'session_close':
      return await closeSession(sessionId, tabId);

    // ── Tab Management ──
    case 'tabs':
      return await handleGetTabs();
    case 'new_tab':
      return await handleNewTab(payload.url, sessionId);
    case 'close_tab':
      return await handleCloseTab(payload.tabId);
    case 'switch_tab':
      return await handleSwitchTab(payload.tabId, sessionId);

    // ── Navigation ──
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
    default:
      if (CONTENT_COMMANDS.has(type)) {
        return await relayToContent(type, payload, tabId, sessionId);
      }
      if (type === 'click_text') {
        return await trustedClickText(payload, tabId, sessionId);
      }
      if (type === 'ping') {
        return { pong: true };
      }
      throw new Error(`Unknown command: ${type}`);
  }
}
