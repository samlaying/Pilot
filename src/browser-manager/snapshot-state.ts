/**
 * SnapshotState — manages the last-snapshot text for snapshot diffing.
 */

import type { SharedState } from './shared-state.js';

export interface ISnapshotState {
  setLastSnapshot(text: string | null): void;
  getLastSnapshot(): string | null;
}

export class SnapshotState implements ISnapshotState {
  constructor(private state: SharedState) {}

  setLastSnapshot(text: string | null): void {
    this.state.lastSnapshot = text;
  }

  getLastSnapshot(): string | null {
    return this.state.lastSnapshot;
  }
}
