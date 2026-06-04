/**
 * Pilot MCP — Navigation Commands
 *
 * Navigate, go back, go forward, reload, and get URL
 * for a session's tab.
 */

import { resolveSessionTab } from './sessions';
import { waitForTabLoad } from './tabs';

export async function navigate(url: string, tabId: number | undefined, sessionId: string | undefined) {
  const id = await resolveSessionTab(tabId, sessionId);
  await chrome.tabs.update(id, { url });
  await waitForTabLoad(id);
  const updated = await chrome.tabs.get(id);
  return { url: updated.url, tabId: id };
}

export async function goBack(tabId: number | undefined, sessionId: string | undefined) {
  const id = await resolveSessionTab(tabId, sessionId);
  await chrome.tabs.goBack(id);
  await waitForTabLoad(id);
  const updated = await chrome.tabs.get(id);
  return { url: updated.url, tabId: id };
}

export async function goForward(tabId: number | undefined, sessionId: string | undefined) {
  const id = await resolveSessionTab(tabId, sessionId);
  await chrome.tabs.goForward(id);
  await waitForTabLoad(id);
  const updated = await chrome.tabs.get(id);
  return { url: updated.url, tabId: id };
}

export async function doReload(tabId: number | undefined, sessionId: string | undefined) {
  const id = await resolveSessionTab(tabId, sessionId);
  await chrome.tabs.reload(id);
  await waitForTabLoad(id);
  const updated = await chrome.tabs.get(id);
  return { url: updated.url, tabId: id };
}

export async function getUrl(tabId: number | undefined, sessionId: string | undefined) {
  const id = await resolveSessionTab(tabId, sessionId);
  const tab = await chrome.tabs.get(id);
  return { url: tab.url, tabId: id };
}
