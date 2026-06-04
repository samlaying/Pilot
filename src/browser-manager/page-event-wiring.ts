/**
 * page-event-wiring — wires console, network, dialog, and navigation event
 * handlers onto a Playwright Page using SharedState for config reads.
 */

import type { Page } from 'playwright';
import {
  addConsoleEntry,
  addNetworkEntry,
  addDialogEntry,
  networkBuffer,
  type DialogEntry,
} from '../buffers.js';
import type { SharedState } from './shared-state.js';

/**
 * Wire all event handlers onto a page instance.
 *
 * @param page    The Playwright Page to wire.
 * @param state   SharedState for reading dialog config and clearing refs.
 * @param clearRefs Callback to clear the ref map (from RefMap sub-module).
 */
export function wirePageEvents(page: Page, state: SharedState, clearRefs: () => void): void {
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      clearRefs();
    }
  });

  page.on('dialog', async (dialog) => {
    const entry: DialogEntry = {
      timestamp: Date.now(),
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue() || undefined,
      action: state.dialogAutoAccept ? 'accepted' : 'dismissed',
      response: state.dialogAutoAccept ? (state.dialogPromptText ?? undefined) : undefined,
    };
    addDialogEntry(entry);

    try {
      if (state.dialogAutoAccept) {
        await dialog.accept(state.dialogPromptText ?? undefined);
      } else {
        await dialog.dismiss();
      }
    } catch {}
  });

  page.on('console', (msg) => {
    addConsoleEntry({
      timestamp: Date.now(),
      level: msg.type(),
      text: msg.text(),
    });
  });

  page.on('request', (req) => {
    addNetworkEntry({
      timestamp: Date.now(),
      method: req.method(),
      url: req.url(),
    });
  });

  page.on('response', (res) => {
    const url = res.url();
    const status = res.status();
    for (let i = networkBuffer.length - 1; i >= 0; i--) {
      const entry = networkBuffer.get(i);
      if (entry && entry.url === url && !entry.status) {
        networkBuffer.set(i, { ...entry, status, duration: Date.now() - entry.timestamp });
        break;
      }
    }
  });

  page.on('requestfinished', async (req) => {
    try {
      const res = await req.response();
      if (res) {
        const url = req.url();
        const body = await res.body().catch(() => null);
        const size = body ? body.length : 0;
        for (let i = networkBuffer.length - 1; i >= 0; i--) {
          const entry = networkBuffer.get(i);
          if (entry && entry.url === url && !entry.size) {
            networkBuffer.set(i, { ...entry, size });
            break;
          }
        }
      }
    } catch {}
  });
}
