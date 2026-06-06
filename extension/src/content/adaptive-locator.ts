/**
 * Adaptive element relocation for the content script.
 *
 * Inspired by Scrapling's save-then-relocate approach, but tuned for browser
 * interactions: only interactive candidates are considered and risky clicks
 * require a stronger match.
 */

import { isVisible } from './utils';

export interface ElementFingerprint {
  ref: string;
  origin: string;
  role: string;
  tag: string;
  type: string;
  name: string;
  text: string;
  attrs: Record<string, string>;
  tagPath: string[];
  parentTag: string;
  parentText: string;
  parentAttrs: Record<string, string>;
  siblings: string[];
  nearbyText: string;
  rect: { width: number; height: number };
  href: string;
}

export interface AdaptiveMatch {
  element: Element;
  score: number;
  ambiguous: boolean;
  reason: string;
}

const fingerprints = new Map<string, ElementFingerprint>();

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'details',
  'label',
  '[role]',
  '[onclick]',
  '[tabindex]',
].join(',');

const HIGH_RISK_ACTION_RE = /submit|delete|remove|pay|purchase|buy|checkout|confirm|apply|投递|提交|删除|支付|付款|购买|确认|发送|保存/i;

export function rememberElement(ref: string, el: Element): void {
  fingerprints.set(ref, fingerprintElement(ref, el));
}

export function rememberResolvedElement(ref: string | undefined, selector: string | undefined, el: Element): void {
  if (ref) rememberElement(ref, el);
  if (selector) rememberElement(selector, el);
}

export function adaptiveResolveElement(ref: string | undefined, selector: string | undefined): AdaptiveMatch | null {
  const key = selector || ref;
  if (!key) return null;
  const original = fingerprints.get(key);
  if (!original) return null;
  if (original.origin !== location.origin) return null;

  const candidates = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))
    .filter(el => el.isConnected && isVisible(el))
    .map(el => ({ el, score: scoreFingerprint(original, fingerprintElement('', el)) }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best) return null;

  const secondScore = candidates[1]?.score ?? 0;
  const margin = best.score - secondScore;
  const risky = isRisky(original);
  const minScore = risky ? 0.88 : 0.78;
  const minMargin = risky ? 0.12 : 0.08;
  const ambiguous = margin < minMargin;

  if (best.score < minScore || ambiguous) {
    const reason = `adaptive match refused for ${key}: score=${best.score.toFixed(2)}, margin=${margin.toFixed(2)}`;
    throw new Error(reason);
  }

  rememberElement(key, best.el);
  return {
    element: best.el,
    score: best.score,
    ambiguous,
    reason: `adaptive match for ${key}: score=${best.score.toFixed(2)}, margin=${margin.toFixed(2)}`,
  };
}

function fingerprintElement(ref: string, el: Element): ElementFingerprint {
  const htmlEl = el as HTMLElement;
  const inputEl = el as HTMLInputElement;
  const rect = el.getBoundingClientRect();
  const parent = el.parentElement;
  return {
    ref,
    origin: location.origin,
    role: getRole(el),
    tag: el.tagName.toLowerCase(),
    type: inputEl.type?.toLowerCase() || '',
    name: normalize(getAccessibleName(el) || ''),
    text: normalize(el.textContent || ''),
    attrs: stableAttrs(el),
    tagPath: tagPath(el),
    parentTag: parent?.tagName.toLowerCase() || '',
    parentText: normalize(parent?.textContent || ''),
    parentAttrs: parent ? stableAttrs(parent) : {},
    siblings: parent ? Array.from(parent.children).filter(child => child !== el).map(child => child.tagName.toLowerCase()) : [],
    nearbyText: normalize(nearbyText(el)),
    rect: { width: Math.round(rect.width), height: Math.round(rect.height) },
    href: htmlEl instanceof HTMLAnchorElement ? htmlEl.href : '',
  };
}

function scoreFingerprint(original: ElementFingerprint, candidate: ElementFingerprint): number {
  const parts = [
    weighted(original.role === candidate.role ? 1 : 0, 0.18),
    weighted(original.tag === candidate.tag ? 1 : 0, 0.08),
    weighted(original.type ? textSimilarity(original.type, candidate.type) : 1, 0.07),
    weighted(textSimilarity(original.name, candidate.name), 0.26),
    weighted(textSimilarity(original.text, candidate.text), 0.10),
    weighted(dictSimilarity(original.attrs, candidate.attrs), 0.14),
    weighted(sequenceSimilarity(original.tagPath, candidate.tagPath), 0.06),
    weighted(original.parentTag === candidate.parentTag ? 1 : 0, 0.04),
    weighted(textSimilarity(original.parentText, candidate.parentText), 0.03),
    weighted(dictSimilarity(original.parentAttrs, candidate.parentAttrs), 0.02),
    weighted(sequenceSimilarity(original.siblings, candidate.siblings), 0.01),
    weighted(textSimilarity(original.nearbyText, candidate.nearbyText), 0.01),
  ];
  const score = parts.reduce((sum, part) => sum + part, 0);
  if (original.role === candidate.role && original.tag === candidate.tag && original.name && original.name === candidate.name) {
    return Math.max(score, 0.9);
  }
  return score;
}

function weighted(score: number, weight: number): number {
  return Math.max(0, Math.min(1, score)) * weight;
}

function getRole(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit.toLowerCase();
  const tag = el.tagName.toLowerCase();
  const type = (el as HTMLInputElement).type?.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'input') {
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'submit' || type === 'button') return 'button';
    return 'textbox';
  }
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'label') return 'label';
  return tag;
}

function getAccessibleName(el: Element): string {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map(id => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }

  const inputEl = el as HTMLInputElement;
  const labels = inputEl.labels ? Array.from(inputEl.labels).map(label => label.textContent?.trim()).filter(Boolean).join(' ') : '';
  if (labels) return labels;

  return (
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('title') ||
    el.getAttribute('alt') ||
    (inputEl.id && document.querySelector(`label[for="${cssEscape(inputEl.id)}"]`)?.textContent?.trim()) ||
    el.textContent?.trim() ||
    ''
  );
}

function stableAttrs(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (
      name === 'id' ||
      name === 'name' ||
      name === 'type' ||
      name === 'href' ||
      name.startsWith('aria-') ||
      name.startsWith('data-')
    ) {
      attrs[name] = normalize(attr.value).slice(0, 120);
    }
  }
  return attrs;
}

function tagPath(el: Element): string[] {
  const path: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body && path.length < 8) {
    path.unshift(current.tagName.toLowerCase());
    current = current.parentElement;
  }
  return path;
}

function nearbyText(el: Element): string {
  const parent = el.parentElement;
  if (!parent) return '';
  const texts = Array.from(parent.children)
    .filter(child => child !== el)
    .map(child => child.textContent?.trim() || '')
    .filter(Boolean);
  return texts.join(' ');
}

function isRisky(fingerprint: ElementFingerprint): boolean {
  return HIGH_RISK_ACTION_RE.test([
    fingerprint.name,
    fingerprint.text,
    fingerprint.nearbyText,
    fingerprint.attrs['aria-label'] || '',
    fingerprint.attrs['data-testid'] || '',
  ].join(' '));
}

function textSimilarity(a: string, b: string): number {
  const left = normalize(a);
  const right = normalize(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;
  const maxLen = Math.max(left.length, right.length);
  return (maxLen - levenshtein(left, right)) / maxLen;
}

function sequenceSimilarity(a: string[], b: string[]): number {
  return textSimilarity(a.join('/'), b.join('/'));
}

function dictSimilarity(a: Record<string, string>, b: Record<string, string>): number {
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  if (!keys.length) return 1;
  return keys.reduce((sum, key) => sum + textSimilarity(a[key] || '', b[key] || ''), 0) / keys.length;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}
