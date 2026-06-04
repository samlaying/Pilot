/**
 * FailureTracker — tracks consecutive tool failures for hint generation.
 */

import type { SharedState } from './shared-state.js';

export interface IFailureTracker {
  incrementFailures(): void;
  resetFailures(): void;
  getFailureHint(): string | null;
}

export class FailureTracker implements IFailureTracker {
  constructor(private state: SharedState) {}

  incrementFailures(): void {
    this.state.consecutiveFailures++;
  }

  resetFailures(): void {
    this.state.consecutiveFailures = 0;
  }

  getFailureHint(): string | null {
    if (this.state.consecutiveFailures >= 3) {
      return `HINT: ${this.state.consecutiveFailures} consecutive failures. Try running pilot_snapshot for fresh refs.`;
    }
    return null;
  }
}
