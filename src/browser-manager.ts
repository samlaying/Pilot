/**
 * Backward-compatible re-export barrel.
 *
 * Node16 module resolution requires explicit `.js` extensions and does NOT
 * resolve `./browser-manager.js` to `./browser-manager/index.ts`.  Keeping
 * this thin file lets all existing consumers keep `import … from
 * '../browser-manager.js'` unchanged.
 */

export { BrowserManager } from './browser-manager/index.js';
export type { BrowserState } from './browser-manager/shared-state.js';
