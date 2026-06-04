/**
 * FrameManager — manages iframe frame selection and reset.
 */

import type { Frame, Page } from 'playwright';
import type { SharedState } from './shared-state.js';

export interface IFrameManager {
  getActiveFrame(): Frame;
  setActiveFrame(frame: Frame | null): void;
  listFrames(): Promise<Array<{ index: number; url: string; name: string; isMain: boolean }>>;
  selectFrameByIndex(index: number): Frame;
  selectFrameByName(name: string): Frame;
  resetFrame(): void;
}

export class FrameManager implements IFrameManager {
  constructor(
    private state: SharedState,
    private getPage: () => Page,
    private clearRefs: () => void,
  ) {}

  getActiveFrame(): Frame {
    if (this.state.activeFrame && !this.state.activeFrame.isDetached()) {
      return this.state.activeFrame;
    }
    this.state.activeFrame = null;
    return this.getPage().mainFrame();
  }

  setActiveFrame(frame: Frame | null): void {
    this.state.activeFrame = frame;
    this.clearRefs();
  }

  async listFrames(): Promise<Array<{ index: number; url: string; name: string; isMain: boolean }>> {
    const page = this.getPage();
    return page.frames().map((f, i) => ({
      index: i,
      url: f.url(),
      name: f.name() || '',
      isMain: f === page.mainFrame(),
    }));
  }

  selectFrameByIndex(index: number): Frame {
    const page = this.getPage();
    const frames = page.frames();
    if (index < 0 || index >= frames.length) {
      throw new Error(`Frame index ${index} out of range (0-${frames.length - 1})`);
    }
    const frame = frames[index];
    this.setActiveFrame(frame === page.mainFrame() ? null : frame);
    return frame;
  }

  selectFrameByName(name: string): Frame {
    const page = this.getPage();
    const frame = page.frame({ name });
    if (!frame) {
      throw new Error(`Frame "${name}" not found. Use pilot_frames to list available frames.`);
    }
    this.setActiveFrame(frame === page.mainFrame() ? null : frame);
    return frame;
  }

  resetFrame(): void {
    this.setActiveFrame(null);
  }
}
