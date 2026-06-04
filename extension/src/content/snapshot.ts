/**
 * Accessibility-tree snapshot generation.
 *
 * Assigns data-pilot-ref="eN" attributes to interactive elements so that
 * subsequent commands (click, fill, etc.) can locate them by @eN ref.
 */

import { truncate } from './utils';

/** Current ref counter value (read-only from outside; use incrementRefCounter to change). */
export let refCounter = 0;

/** Increment the ref counter and return the new value. */
export function incrementRefCounter(): number {
  return ++refCounter;
}

/** HTML tags that are considered interactive. */
export const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'details', 'summary']);

/** ARIA roles that are considered interactive. */
export const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'listbox', 'menuitem', 'option', 'searchbox', 'slider', 'switch', 'tab',
]);

export interface SnapshotOptions {
  maxElements?: number;
  interactive_only?: boolean;
  structure_only?: boolean;
  lean?: boolean;
  maxDepth?: number;
}

export interface SnapshotResult {
  text: string;
  url: string;
  title: string;
  count: number;
}

/** Remove all existing data-pilot-ref attributes from the document. */
export function clearOldRefs(): void {
  document.querySelectorAll('[data-pilot-ref]').forEach(el => el.removeAttribute('data-pilot-ref'));
}

/** Main snapshot: walk the DOM and produce a text representation of the accessibility tree. */
export function snapshot(opts: SnapshotOptions = {}): SnapshotResult {
  const { maxElements = 200, interactive_only = false, structure_only = false, lean = true, maxDepth } = opts;

  // Clear previous refs
  clearOldRefs();
  refCounter = 0;

  const lines: string[] = [];
  const seen = new Set<Element>();
  let count = 0;

  // Lean mode: skip noise elements
  const LEAN_SKIP_TAGS = new Set(['br', 'hr', 'wbr', 'col', 'colgroup', 'thead', 'tbody', 'tfoot']);
  const LEAN_SKIP_ROLES = new Set(['separator', 'presentation', 'none']);

  function visit(el: Element, depth: number): void {
    if (count >= maxElements) return;
    if (seen.has(el)) return;
    if (maxDepth !== undefined && depth > maxDepth) return;
    seen.add(el);

    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'svg', 'noscript', 'template'].includes(tag)) return;

    const role = el.getAttribute('role') || inferRole(el);
    const isInteractive = INTERACTIVE_TAGS.has(tag) || INTERACTIVE_ROLES.has(role);

    // Lean: skip structural noise
    if (lean && LEAN_SKIP_TAGS.has(tag)) return;
    if (lean && LEAN_SKIP_ROLES.has(role)) return;

    // interactive_only: skip non-interactive elements entirely
    if (interactive_only && !isInteractive) {
      // Still recurse into children to find nested interactive elements
      for (const child of el.children) visit(child, depth);
      return;
    }

    const name = getAccessibleName(el);
    const indent = interactive_only ? '  '.repeat(Math.min(depth, 2)) : '  '.repeat(depth);

    // Assign ref to interactive elements
    let ref = '';
    if (isInteractive && name) {
      refCounter++;
      const refId = `e${refCounter}`;
      el.setAttribute('data-pilot-ref', refId);
      ref = ` [@${refId}]`;
      count++;
    }

    if (structure_only) {
      // Just the tree shape, no text content
      if (isInteractive) {
        lines.push(`${indent}- ${role}${ref}`);
      } else if (['h1','h2','h3','h4','h5','h6','nav','main','header','footer','section','article','aside','form'].includes(tag)) {
        lines.push(`${indent}- ${tag}`);
      }
    } else {
      const props = getProps(el);
      const label = name ? ` "${truncate(name, 80)}"` : '';

      if (isInteractive && name) {
        lines.push(`${indent}- ${role}${label}${props}${ref}`);
      } else if (['h1','h2','h3','h4','h5','h6'].includes(tag)) {
        const text = el.textContent?.trim();
        if (text) lines.push(`${indent}- heading "${truncate(text, 100)}"`);
      } else if (!lean || !interactive_only) {
        // Text nodes — only in non-lean or when showing everything
        if (['p', 'span', 'div', 'li', 'td', 'th', 'label', 'figcaption'].includes(tag)) {
          const directText = getDirectText(el);
          if (directText && directText.length > 2) {
            if (!lean || directText.length > 10) { // lean: skip very short text fragments
              lines.push(`${indent}- text "${truncate(directText, 120)}"`);
            }
          }
        }
      }
    }

    // Recurse
    for (const child of el.children) {
      visit(child, depth + 1);
    }
  }

  visit(document.body, 0);
  return { text: lines.join('\n') || '(no accessible elements found)', url: location.href, title: document.title, count };
}

/** Map a tag name to its inferred ARIA role. */
export function inferRole(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const type = (el as HTMLInputElement).type?.toLowerCase();
  switch (tag) {
    case 'a':        return 'link';
    case 'button':   return 'button';
    case 'input':    return type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : type === 'submit' ? 'button' : 'textbox';
    case 'select':   return 'combobox';
    case 'textarea': return 'textbox';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    case 'nav':      return 'navigation';
    case 'main':     return 'main';
    default:         return tag;
  }
}

/** Get the accessible name for an element (aria-label, placeholder, title, etc.). */
export function getAccessibleName(el: Element): string | null {
  // aria-labelledby takes highest priority
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
    if (text) return text;
  }
  return (
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('title') ||
    el.getAttribute('alt') ||
    (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()) ||
    el.textContent?.trim().slice(0, 100) ||
    null
  );
}

/** Extract element properties (disabled, checked, expanded, etc.) as a display string. */
export function getProps(el: Element): string {
  const props: string[] = [];
  const htmlEl = el as HTMLElement;
  if ('disabled' in htmlEl && Boolean((htmlEl as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled)) {
    props.push('disabled');
  }
  if ('checked' in htmlEl && (htmlEl as HTMLInputElement).checked) props.push('checked');
  if (el.getAttribute('aria-expanded') === 'true') props.push('expanded');
  if (el.getAttribute('aria-selected') === 'true') props.push('selected');
  if ((htmlEl as HTMLInputElement).value && el.tagName.toLowerCase() === 'input') {
    props.push(`value="${truncate((htmlEl as HTMLInputElement).value, 40)}"`);
  }
  return props.length ? ` [${props.join(', ')}]` : '';
}

/** Get the direct text content of an element (not from children). */
export function getDirectText(el: Element): string {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
  }
  return text.trim().replace(/\s+/g, ' ');
}
