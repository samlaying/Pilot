/**
 * DOM interaction commands: click, fill, type, press, scroll, hover, select.
 */

import { adaptiveResolveElement, rememberResolvedElement } from './adaptive-locator';
import { resolveElement, sleep, fireMouseEvent, buttonIndex } from './utils';

// ─── Click ────────────────────────────────────────────────────

export interface ClickOptions {
  ref?: string;
  selector?: string;
  x?: number;
  y?: number;
  button?: string;
  double_click?: boolean;
}

export async function click(opts: ClickOptions): Promise<{ clicked: string }> {
  const { ref, selector, x, y, button = 'left', double_click = false } = opts;
  let el = resolveElement(ref, selector);
  let adaptiveReason = '';
  if (!el) {
    const adaptive = adaptiveResolveElement(ref, selector);
    if (adaptive) {
      el = adaptive.element;
      adaptiveReason = ` (${adaptive.reason})`;
    }
  }

  if (el) {
    rememberResolvedElement(ref, selector, el);
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    await sleep(50);
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    fireMouseEvent(el, 'mousedown', cx, cy, button);
    fireMouseEvent(el, 'mouseup', cx, cy, button);

    // React synthetic event fix: for checkbox/radio inputs, React intercepts
    // the `checked` property setter. Direct assignment won't trigger onChange.
    // Use the native setter via Object.getOwnPropertyDescriptor to bypass React's
    // monkey-patched setter, then dispatch bubbling events so React's root-level
    // listener picks up the state change. This mirrors the approach used in fill()
    // for text input values.
    if (!double_click && el.tagName === 'INPUT') {
      const inputEl = el as HTMLInputElement;
      if (inputEl.type === 'checkbox' || inputEl.type === 'radio') {
        if (inputEl.disabled) throw new Error('Element is disabled');
        const nativeCheckedSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype, 'checked'
        )?.set;
        const nextChecked = inputEl.type === 'radio' ? true : !inputEl.checked;
        if (nativeCheckedSetter) {
          nativeCheckedSetter.call(inputEl, nextChecked);
        } else {
          inputEl.checked = nextChecked;
        }
        inputEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: buttonIndex(button) }));
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        (el as HTMLElement).click();
      }
    } else if (double_click) {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: buttonIndex(button) }));
    } else {
      (el as HTMLElement).click();
    }
    await sleep(100);
    return { clicked: `${ref || selector || ''}${adaptiveReason}` };
  } else if (x !== undefined && y !== undefined) {
    const target = document.elementFromPoint(x, y);
    if (target) {
      fireMouseEvent(target, 'mousedown', x, y, button);
      fireMouseEvent(target, 'mouseup', x, y, button);
      (target as HTMLElement).click();
      await sleep(100);
      return { clicked: `(${x}, ${y})` };
    }
  }
  throw new Error(`Element not found: ${ref || selector}`);
}

// ─── Fill ─────────────────────────────────────────────────────

export interface FillOptions {
  ref?: string;
  selector?: string;
  value: string;
}

export async function fill(opts: FillOptions): Promise<{ filled: string; value: string }> {
  const { ref, selector, value } = opts;
  const el = resolveElement(ref, selector);
  if (!el) throw new Error(`Element not found: ${ref || selector}`);

  (el as HTMLElement).focus();
  await sleep(30);

  const nativeInputSetter =
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

  if (nativeInputSetter) {
    nativeInputSetter.call(el, value);
  } else {
    (el as HTMLInputElement).value = value;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(50);
  return { filled: ref || selector || '', value };
}

// ─── Type ─────────────────────────────────────────────────────

export interface TypeTextOptions {
  text: string;
  selector?: string;
  ref?: string;
}

export async function typeText(opts: TypeTextOptions): Promise<{ typed: string }> {
  const { text, selector, ref } = opts;
  if (selector || ref) {
    const el = resolveElement(ref, selector);
    if (el) (el as HTMLElement).focus();
  }

  for (const char of text) {
    const active = document.activeElement as HTMLElement | null;
    active?.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    active?.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));

    if (active && 'value' in active) {
      (active as HTMLInputElement).value += char;
      active.dispatchEvent(new Event('input', { bubbles: true }));
    }

    active?.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await sleep(20);
  }
  return { typed: text.length + ' chars' };
}

// ─── Press Key ────────────────────────────────────────────────

export interface PressKeyOptions {
  key: string;
}

export async function pressKey(opts: PressKeyOptions): Promise<{ pressed: string }> {
  const { key } = opts;
  const active = document.activeElement || document.body;
  const eventInit: KeyboardEventInit = { key, bubbles: true, cancelable: true };

  // Map common Playwright key names
  const keyMap: Record<string, string> = {
    Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace',
    Delete: 'Delete', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', Space: ' ',
  };
  const mappedKey = keyMap[key] || key;
  const init = { ...eventInit, key: mappedKey };

  active.dispatchEvent(new KeyboardEvent('keydown', init));
  active.dispatchEvent(new KeyboardEvent('keypress', init));
  active.dispatchEvent(new KeyboardEvent('keyup', init));

  if (mappedKey === 'Enter' && active.tagName === 'FORM') {
    (active as HTMLFormElement).submit();
  } else if (mappedKey === 'Enter') {
    active.dispatchEvent(new Event('submit', { bubbles: true }));
  }

  await sleep(50);
  return { pressed: key };
}

// ─── Scroll ───────────────────────────────────────────────────

export interface ScrollOptions {
  ref?: string;
  selector?: string;
  deltaX?: number;
  deltaY?: number;
  x?: number;
  y?: number;
}

export async function scroll(opts: ScrollOptions): Promise<{ scrolled: string }> {
  const { ref, selector, deltaX = 0, deltaY = 300, x, y } = opts;
  if (ref || selector) {
    const el = resolveElement(ref, selector);
    if (el) {
      el.scrollBy({ left: deltaX, top: deltaY, behavior: 'smooth' });
      await sleep(300);
      return { scrolled: ref || selector || '' };
    }
  }
  window.scrollBy({ left: x ?? deltaX, top: y ?? deltaY, behavior: 'smooth' });
  await sleep(300);
  return { scrolled: 'window' };
}

// ─── Hover ───────────────────────────────────────────────────

export interface HoverOptions {
  ref?: string;
  selector?: string;
}

export async function hover(opts: HoverOptions): Promise<{ hovered: string }> {
  const { ref, selector } = opts;
  const el = resolveElement(ref, selector);
  if (!el) throw new Error(`Element not found: ${ref || selector}`);
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  await sleep(50);
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }));
  el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
  await sleep(100);
  return { hovered: ref || selector || '' };
}

// ─── Select Option ───────────────────────────────────────────

export interface SelectOptionOptions {
  ref?: string;
  selector?: string;
  value?: string;
  label?: string;
}

export async function selectOption(opts: SelectOptionOptions): Promise<{ selected: string; value: string }> {
  const { ref, selector, value, label } = opts;
  const el = resolveElement(ref, selector);
  if (!el) throw new Error(`Element not found: ${ref || selector}`);
  if (el.tagName.toLowerCase() !== 'select') throw new Error('Element is not a <select>');

  const selectEl = el as HTMLSelectElement;
  let option: HTMLOptionElement | undefined;
  if (label) {
    option = Array.from(selectEl.options).find(o => o.textContent?.trim() === label);
  } else if (value !== undefined) {
    option = Array.from(selectEl.options).find(o => o.value === value);
  }
  if (!option) throw new Error(`Option not found: ${label || value}`);

  selectEl.value = option.value;
  selectEl.dispatchEvent(new Event('input', { bubbles: true }));
  selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(50);
  return { selected: option.textContent?.trim() || '', value: option.value };
}
