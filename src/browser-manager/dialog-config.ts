/**
 * DialogConfig — manages dialog auto-accept and prompt text settings.
 */

import type { SharedState } from './shared-state.js';

export interface IDialogConfig {
  setDialogAutoAccept(accept: boolean): void;
  getDialogAutoAccept(): boolean;
  setDialogPromptText(text: string | null): void;
  getDialogPromptText(): string | null;
}

export class DialogConfig implements IDialogConfig {
  constructor(private state: SharedState) {}

  setDialogAutoAccept(accept: boolean): void {
    this.state.dialogAutoAccept = accept;
  }

  getDialogAutoAccept(): boolean {
    return this.state.dialogAutoAccept;
  }

  setDialogPromptText(text: string | null): void {
    this.state.dialogPromptText = text;
  }

  getDialogPromptText(): string | null {
    return this.state.dialogPromptText;
  }
}
