/**
 * Shared utilities for the Pilot content script.
 */

/** Resolve an @eN ref via data-pilot-ref attribute, or fall back to CSS selector. */
export function resolveElement(ref: string | undefined, selector: string | undefined): Element | null {
  if (ref && ref.startsWith('@')) {
    return document.querySelector(`[data-pilot-ref="${ref.slice(1)}"]`);
  }
  if (selector) return document.querySelector(selector);
  return null;
}

/** Check whether an element is visible (has nonzero dimensions and is not hidden). */
export function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

/** Promise-based delay. */
export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Truncate a string to maxLen characters, appending an ellipsis if needed. */
export function truncate(str: string, n: number): string {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

/** Dispatch a mouse event on the given element. */
export function fireMouseEvent(el: Element, type: string, x: number, y: number, button: string = 'left'): void {
  el.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: buttonIndex(button),
  }));
}

/** Map a button name to its numeric index. */
export function buttonIndex(b: string): number {
  return b === 'right' ? 2 : b === 'middle' ? 1 : 0;
}
