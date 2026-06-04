/**
 * ExtensionBridge — manages communication with the Chrome extension.
 *
 * Delegates to the singleton ExtensionServer for connection state,
 * send operations, and active tab tracking.
 */

import type { ExtensionServer } from '../extension-server.js';
import { extensionServer } from '../extension-server.js';
import type { SharedState } from './shared-state.js';

export interface IExtensionBridge {
  getExtension(): ExtensionServer | null;
  extSend<T>(type: string, payload?: Record<string, unknown>): Promise<T>;
  setExtActiveTab(tabId: number): void;
  getExtActiveTab(): number | undefined;
}

export class ExtensionBridge implements IExtensionBridge {
  constructor(private state: SharedState) {}

  getExtension(): ExtensionServer | null {
    return extensionServer.isConnected() ? extensionServer : null;
  }

  /** Send a command to the extension, targeting the active tab */
  async extSend<T = unknown>(type: string, payload?: Record<string, unknown>): Promise<T> {
    return extensionServer.send<T>(type, payload, this.state._extActiveTab);
  }

  /** Update the active extension tab (called by pilot_tab_new / pilot_tab_select) */
  setExtActiveTab(tabId: number): void {
    this.state._extActiveTab = tabId;
  }

  getExtActiveTab(): number | undefined {
    return this.state._extActiveTab;
  }
}
