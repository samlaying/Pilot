/**
 * Text search, scoring, and click-by-text functionality.
 *
 * Used for portal-rendered custom dropdowns, overlays, and other elements
 * that may not appear in the accessibility snapshot.
 */

import { sleep, fireMouseEvent, isVisible } from './utils';

// ─── Public API ──────────────────────────────────────────────

export interface ClickTextOptions {
  text: string;
  exact?: boolean;
  selector?: string;
}

export async function clickText(opts: ClickTextOptions): Promise<{ clicked: string }> {
  const { text, exact = true, selector } = opts;
  const target = await getTextClickTarget({ text, exact, selector });

  fireMouseEvent(target.el, 'mousedown', target.x, target.y, 'left');
  fireMouseEvent(target.el, 'mouseup', target.x, target.y, 'left');
  (target.el as HTMLElement).click();
  await sleep(100);
  return { clicked: text };
}

export interface FindTextRectOptions {
  text: string;
  exact?: boolean;
  selector?: string;
}

export async function findTextRect(opts: FindTextRectOptions): Promise<{
  text: string;
  tag: string;
  role: string | null;
  x: number;
  y: number;
}> {
  const { text, exact = true, selector } = opts;
  const target = await getTextClickTarget({ text, exact, selector });
  return {
    text: normalizeText(getElementText(target.el)),
    tag: target.el.tagName.toLowerCase(),
    role: target.el.getAttribute('role') || null,
    x: target.x,
    y: target.y,
  };
}

// ─── Internal helpers ────────────────────────────────────────

interface TextClickTarget {
  el: Element;
  x: number;
  y: number;
}

async function getTextClickTarget(opts: {
  text: string;
  exact: boolean;
  selector?: string;
}): Promise<TextClickTarget> {
  const { text, exact, selector } = opts;
  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) throw new Error(`Selector not found: ${selector}`);

  const target = findVisibleTextElement(root, text, exact);
  if (!target) throw new Error(`Visible text not found: ${text}`);
  const el = findClickableAncestor(target) || target;

  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  await sleep(50);
  const rect = el.getBoundingClientRect();
  return {
    el,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export function findVisibleTextElement(root: Element, text: string, exact: boolean): Element | null {
  const candidates = Array.from(root.querySelectorAll([
    '[role="option"]',
    '[role="menuitem"]',
    '[role="listitem"]',
    '[role="button"]',
    'li',
    'div',
    'span',
    'button',
    'a',
  ].join(',')));

  const normalizedTarget = normalizeText(text);
  const matches = candidates
    .filter(isVisible)
    .filter(el => {
      const candidateText = normalizeText(getElementText(el));
      return exact ? candidateText === normalizedTarget : candidateText.includes(normalizedTarget);
    })
    .sort((a, b) => scoreTextMatchCandidate(b, normalizedTarget) - scoreTextMatchCandidate(a, normalizedTarget));

  return matches[0] || null;
}

export function scoreTextClickCandidate(el: Element): number {
  let score = 0;
  const role = el.getAttribute('role');
  const className = typeof el.className === 'string' ? el.className.toLowerCase() : '';
  const attrText = [
    el.getAttribute('data-value'),
    el.getAttribute('data-key'),
    el.getAttribute('value'),
  ].filter(Boolean).join(' ');

  if (role === 'option') score += 50;
  if (role === 'menuitem' || role === 'listitem') score += 30;
  if (role === 'button') score += 10;
  if (['LI', 'BUTTON', 'A'].includes(el.tagName)) score += 20;
  if (el.hasAttribute('data-value') || el.hasAttribute('data-key')) score += 35;
  if (el.hasAttribute('aria-selected')) score += 30;
  if (/\b(option|item|select|dropdown|drop-down|list|result|choice)\b/i.test(className)) score += 35;
  if (/\b(menu|content)\b/i.test(className)) score += 8;
  if (/\b(label|text)\b/i.test(className)) score += 4;
  if (/\b(header|container|wrapper|arrow|icon|placeholder|input)\b/i.test(className)) score -= 25;
  if (attrText) score += 12;
  if (el.getAttribute('aria-selected') === 'true') score -= 10;
  score -= Math.min(25, el.children.length * 2);
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) score += 2;
  return score;
}

function scoreTextMatchCandidate(el: Element, normalizedTarget: string): number {
  const candidateText = normalizeText(getElementText(el));
  const clickTarget = findClickableAncestor(el) || el;
  let score = scoreTextClickCandidate(clickTarget);
  if (candidateText === normalizedTarget) score += 80;
  score -= Math.min(40, Math.max(0, candidateText.length - normalizedTarget.length) / 4);
  if (el !== clickTarget) score += 10;
  return score;
}

/** Normalize whitespace and trim. */
export function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/** Walk up the DOM tree to find the best clickable ancestor. */
export function findClickableAncestor(el: Element): Element | null {
  const candidates: Element[] = [];
  let current: Element | null = el;
  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    candidates.push(current);
    current = current.parentElement;
  }

  return candidates
    .filter(isVisible)
    .map(candidate => ({ candidate, score: scoreTextClickCandidate(candidate) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.candidate || null;
}

function getElementText(el: Element): string {
  return 'innerText' in el ? String(el.innerText || '') : (el.textContent || '');
}
