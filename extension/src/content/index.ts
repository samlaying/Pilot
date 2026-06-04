/**
 * Pilot MCP — Content Script (TypeScript entry point)
 *
 * Executes commands in the page context:
 * snapshot, click, fill, type, press, scroll, evaluate, page_text, page_html, etc.
 *
 * Ref system: assigns data-pilot-ref="eN" to interactive elements during snapshot,
 * so subsequent click(@e3) / fill(@e3) commands can locate elements.
 *
 * esbuild bundles all imports into a single IIFE, so cross-module calls work
 * exactly as if everything were in one file.
 */

import { snapshot } from './snapshot';
import { click, fill, typeText, pressKey, scroll, hover, selectOption, type FillOptions, type TypeTextOptions, type PressKeyOptions } from './interactions';
import { clickText, findTextRect, type ClickTextOptions, type FindTextRectOptions } from './text-matching';
import { evaluate, pageText, pageHtml, pageLinks, pageForms, type EvaluateOptions } from './page-info';
import { domFind, findElement, elementState, waitFor } from './dom-query';
import { uploadFile, type UploadFileOptions } from './file-upload';

// ─── Message Types ───────────────────────────────────────────

interface PilotMessage {
  type: string;
  payload?: Record<string, any>;
}

interface PilotResponse {
  result?: any;
  error?: string;
}

// ─── Message Handler ─────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (msg: PilotMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response: PilotResponse) => void) => {
    handleMessage(msg)
      .then(result => sendResponse({ result }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // async response
  }
);

async function handleMessage({ type, payload = {} }: PilotMessage): Promise<any> {
  switch (type) {
    case 'snapshot':       return snapshot(payload);
    case 'click':          return click(payload);
    case 'fill':           return fill(payload as FillOptions);
    case 'type':           return typeText(payload as TypeTextOptions);
    case 'press':          return pressKey(payload as PressKeyOptions);
    case 'scroll':         return scroll(payload);
    case 'hover':          return hover(payload);
    case 'select_option':  return selectOption(payload);
    case 'click_text':     return clickText(payload as ClickTextOptions);
    case 'find_text_rect': return findTextRect(payload as FindTextRectOptions);
    case 'upload_file':    return uploadFile(payload as UploadFileOptions);
    case 'wait':           return waitFor(payload);
    case 'find':           return findElement(payload);
    case 'page_links':     return pageLinks();
    case 'page_forms':     return pageForms();
    case 'element_state':  return elementState(payload);
    case 'dom_find':       return domFind(payload);
    case 'evaluate':       return evaluate(payload as EvaluateOptions);
    case 'page_text':      return pageText();
    case 'page_html':      return pageHtml(payload);
    default:               throw new Error(`Unknown content command: ${type}`);
  }
}
