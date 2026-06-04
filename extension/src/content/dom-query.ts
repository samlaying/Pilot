/**
 * DOM querying: deep search, element finding, state inspection, and waiting.
 */

import { resolveElement, isVisible, sleep } from './utils';
import { normalizeText, findClickableAncestor, scoreTextClickCandidate } from './text-matching';
import { inferRole, incrementRefCounter } from './snapshot';

// ─── DOM Find ────────────────────────────────────────────────

export interface DomFindOptions {
  text?: string;
  selector?: string;
  exact?: boolean;
  visibleOnly?: boolean;
  limit?: number;
}

export function domFind(opts: DomFindOptions = {}): { matches: any[]; count: number } {
  const { text, selector, exact = false, visibleOnly = true, limit = 20 } = opts;
  const root = selector ? document.querySelector(selector) : document;
  if (!root) throw new Error(`Selector not found: ${selector}`);

  const candidates = collectDomElements(root)
    .filter(el => !visibleOnly || isVisible(el))
    .filter(el => {
      if (!text) return true;
      const candidateText = normalizeText(getElementText(el));
      const targetText = normalizeText(text);
      return exact ? candidateText === targetText : candidateText.includes(targetText);
    })
    .sort((a, b) => scoreDomFindCandidate(b, text) - scoreDomFindCandidate(a, text))
    .slice(0, Math.max(1, Math.min(limit, 100)))
    .map(describeElement);

  return { matches: candidates, count: candidates.length };
}

// ─── Find Element ────────────────────────────────────────────

export interface FindElementOptions {
  text?: string;
  label?: string;
  role?: string;
  placeholder?: string;
}

export function findElement(opts: FindElementOptions): { ref: string; tag: string; text: string } {
  const { text, label, role, placeholder } = opts;
  let el: Element | null | undefined;

  if (label) {
    const labelEl = Array.from(document.querySelectorAll('label')).find(l => l.textContent?.trim().includes(label));
    if (labelEl?.htmlFor) el = document.getElementById(labelEl.htmlFor);
    if (!el && labelEl) el = labelEl.querySelector('input, select, textarea');
  }
  if (!el && placeholder) {
    el = document.querySelector(`[placeholder*="${placeholder}"]`);
  }
  if (!el && role) {
    el = document.querySelector(`[role="${role}"]`);
    if (!el) {
      const roleMap: Record<string, string> = { button: 'button', link: 'a', textbox: 'input' };
      if (roleMap[role]) el = text
        ? Array.from(document.querySelectorAll(roleMap[role])).find(e => e.textContent?.trim().includes(text))
        : document.querySelector(roleMap[role]);
    }
  }
  if (!el && text) {
    const all = document.querySelectorAll('a, button, [role="button"], [role="link"], input[type="submit"]');
    el = Array.from(all).find(e => e.textContent?.trim().includes(text));
  }
  if (!el) throw new Error(`Element not found: ${text || label || role || placeholder}`);

  // Assign a ref
  const refId = `e${incrementRefCounter()}`;
  el.setAttribute('data-pilot-ref', refId);
  const name = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 80) || '';
  return { ref: `@${refId}`, tag: el.tagName.toLowerCase(), text: name };
}

// ─── Element State ───────────────────────────────────────────

export interface ElementStateOptions {
  ref?: string;
  selector?: string;
}

export function elementState(opts: ElementStateOptions): {
  visible: boolean;
  enabled: boolean;
  checked: boolean | null;
  focused: boolean;
  tag: string;
  text: string;
} {
  const { ref, selector } = opts;
  const el = resolveElement(ref, selector);
  if (!el) throw new Error(`Element not found: ${ref || selector}`);
  const htmlEl = el as HTMLElement;
  const rect = el.getBoundingClientRect();
  const visible = isVisible(el);
  return {
    visible,
    enabled: !(htmlEl as HTMLInputElement).disabled,
    checked: 'checked' in htmlEl ? (htmlEl as HTMLInputElement).checked : null,
    focused: document.activeElement === el,
    tag: el.tagName.toLowerCase(),
    text: el.textContent?.trim().slice(0, 80) || '',
  };
}

// ─── Wait For ────────────────────────────────────────────────

export interface WaitForOptions {
  selector?: string;
  text?: string;
  timeout?: number;
}

export async function waitFor(opts: WaitForOptions): Promise<{ found: string }> {
  const { selector, text, timeout = 10000 } = opts;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (selector && document.querySelector(selector)) return { found: selector };
    if (text && document.body.innerText.includes(text)) return { found: text };
    await sleep(200);
  }
  throw new Error(`Timeout waiting for ${selector || text} after ${timeout}ms`);
}

// ─── Internal helpers ────────────────────────────────────────

function collectDomElements(root: Element | Document): Element[] {
  const out: Element[] = [];
  const visit = (node: Node | null) => {
    if (!node) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      out.push(node as Element);
      if ((node as Element).shadowRoot) visit((node as Element).shadowRoot);
    }
    const children = node instanceof Element || node instanceof DocumentFragment
      ? Array.from(node.children)
      : [];
    for (const child of children) visit(child);
  };
  visit(root instanceof Document ? root.documentElement : root);
  return out;
}

function scoreDomFindCandidate(el: Element, text?: string): number {
  const clickTarget = findClickableAncestor(el) || el;
  let score = scoreTextClickCandidate(clickTarget);
  const tag = el.tagName;
  if (['HTML', 'BODY', 'SCRIPT', 'STYLE'].includes(tag)) score -= 100;
  if (text) {
    const candidateText = normalizeText(getElementText(el));
    const targetText = normalizeText(text);
    if (candidateText === targetText) score += 60;
    score -= Math.min(40, Math.max(0, candidateText.length - targetText.length) / 5);
  }
  return score;
}

function describeElement(el: Element) {
  const rect = el.getBoundingClientRect();
  const clickTarget = findClickableAncestor(el) || el;
  const clickRect = clickTarget.getBoundingClientRect();
  return {
    selector: cssPath(el),
    clickSelector: cssPath(clickTarget),
    clickTag: clickTarget.tagName.toLowerCase(),
    clickRole: clickTarget.getAttribute('role') || inferRole(clickTarget),
    clickClassName: typeof clickTarget.className === 'string' ? clickTarget.className.slice(0, 200) : '',
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || inferRole(el),
    text: normalizeText(getElementText(el)).slice(0, 200),
    ariaLabel: el.getAttribute('aria-label'),
    ariaSelected: el.getAttribute('aria-selected'),
    ariaExpanded: el.getAttribute('aria-expanded'),
    className: typeof el.className === 'string' ? el.className.slice(0, 200) : '',
    id: el.id || null,
    visible: isVisible(el),
    rect: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    clickRect: {
      x: Math.round(clickRect.left),
      y: Math.round(clickRect.top),
      width: Math.round(clickRect.width),
      height: Math.round(clickRect.height),
    },
  };
}

function cssPath(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    let part = current.tagName.toLowerCase();
    const classes = typeof current.className === 'string'
      ? current.className.trim().split(/\s+/).filter(Boolean).slice(0, 3)
      : [];
    if (classes.length) part += classes.map(cls => `.${CSS.escape(cls)}`).join('');
    const parent: Element | null = current.parentElement;
    if (parent) {
      const tagName = current.tagName;
      const siblings = Array.from(parent.children).filter((child): child is Element => child.tagName === tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parent;
  }
  return parts.length ? parts.join(' > ') : current?.tagName?.toLowerCase() || '';
}

function getElementText(el: Element): string {
  return 'innerText' in el ? String(el.innerText || '') : (el.textContent || '');
}
