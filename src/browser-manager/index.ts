/**
 * browser-manager barrel export.
 *
 * Re-exports BrowserManager (facade) and BrowserState type so that
 * consumers can import from 'src/browser-manager/index.js' (or the
 * directory when the old browser-manager.ts is removed).
 */

export { BrowserManager } from './facade.js';
export type { BrowserState } from './shared-state.js';
