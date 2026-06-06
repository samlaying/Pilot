/**
 * Shared utilities for the Pilot content script.
 */

/** Resolve an @eN ref via data-pilot-ref attribute, or fall back to CSS selector. */
export function resolveElement(ref: string | undefined, selector: string | undefined): Element | null {
  if (ref && ref.startsWith('@')) {
    return document.querySelector(`[data-pilot-ref="${ref.slice(1)}"]`);
  }
  // Prefer explicit selector parameter, but also accept ref as a CSS selector fallback
  // (e.g. pilot_click(ref=".my-class") sends ref only, not selector)
  if (selector) return document.querySelector(selector);
  if (ref) return document.querySelector(ref);
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

// ─── Shared DOM helpers (deduplicated from snapshot, adaptive-locator, dom-query, text-matching) ───

/** Infer the ARIA role for an element from its tag and type. */
export function inferRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const type = (el as HTMLInputElement).type?.toLowerCase();
  switch (tag) {
    case 'a':        return 'link';
    case 'button':   return 'button';
    case 'input':    return type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : type === 'submit' || type === 'button' ? 'button' : 'textbox';
    case 'select':   return 'combobox';
    case 'textarea': return 'textbox';
    case 'label':    return 'label';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    case 'nav':      return 'navigation';
    case 'main':     return 'main';
    default:         return tag;
  }
}

/** Get the accessible name for an element (aria-labelledby, label, aria-label, placeholder, etc.). */
export function getAccessibleName(el: Element): string | null {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
    if (text) return text;
  }
  // Associated <label> elements
  const inputEl = el as HTMLInputElement;
  const labels = inputEl.labels ? Array.from(inputEl.labels).map(l => l.textContent?.trim()).filter(Boolean).join(' ') : '';
  if (labels) return labels;
  return (
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('title') ||
    el.getAttribute('alt') ||
    (el.id && document.querySelector(`label[for="${cssEscape(el.id)}"]`)?.textContent?.trim()) ||
    el.textContent?.trim().slice(0, 100) ||
    null
  );
}

/** Get the direct visible text of an element (not from children). */
export function getElementText(el: Element): string {
  return 'innerText' in el ? String((el as HTMLElement).innerText || '') : (el.textContent || '');
}

/** Escape a string for use in a CSS selector. */
export function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
