/**
 * RefMap — manages the @eN/@cN ref map and ref resolution.
 */

import type { Locator } from 'playwright';
import type { RefEntry } from '../types.js';
import type { SharedState } from './shared-state.js';

export interface IRefMap {
  setRefMap(refs: Map<string, RefEntry>): void;
  clearRefs(): void;
  resolveRef(selector: string): Promise<{ locator: Locator } | { selector: string }>;
  getRefRole(selector: string): string | null;
  getRefCount(): number;
  addSingleRef(locator: Locator, role: string, name: string): string;
}

export class RefMap implements IRefMap {
  constructor(private state: SharedState) {}

  setRefMap(refs: Map<string, RefEntry>): void {
    this.state.refMap = refs;
  }

  clearRefs(): void {
    this.state.refMap.clear();
  }

  async resolveRef(selector: string): Promise<{ locator: Locator } | { selector: string }> {
    if (selector.startsWith('@e') || selector.startsWith('@c')) {
      const ref = selector.slice(1);
      const entry = this.state.refMap.get(ref);
      if (!entry) {
        throw new Error(
          `Ref ${selector} not found. Run pilot_snapshot to get fresh refs.`
        );
      }
      const count = await entry.locator.count();
      if (count === 0) {
        throw new Error(
          `Ref ${selector} (${entry.role} "${entry.name}") is stale — element no longer exists. ` +
          `Run pilot_snapshot for fresh refs.`
        );
      }
      return { locator: entry.locator };
    }
    return { selector };
  }

  getRefRole(selector: string): string | null {
    if (selector.startsWith('@e') || selector.startsWith('@c')) {
      const entry = this.state.refMap.get(selector.slice(1));
      return entry?.role ?? null;
    }
    return null;
  }

  getRefCount(): number {
    return this.state.refMap.size;
  }

  addSingleRef(locator: Locator, role: string, name: string): string {
    let maxN = 0;
    for (const k of this.state.refMap.keys()) {
      if (k.startsWith('e')) {
        const n = parseInt(k.slice(1), 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      }
    }
    const ref = `e${maxN + 1}`;
    this.state.refMap.set(ref, { locator, role, name });
    return ref;
  }
}
