/**
 * Pilot MCP — Content Script
 *
 * Executes commands in the page context:
 * snapshot, click, fill, type, press, scroll, evaluate, page_text, page_html
 *
 * Ref system: assigns data-pilot-ref="eN" to interactive elements during snapshot,
 * so subsequent click(@e3) / fill(@e3) commands can locate elements.
 */

let refCounter = 0;

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'details', 'summary']);
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'listbox', 'menuitem', 'option', 'searchbox', 'slider', 'switch', 'tab',
]);

// ─── Message Handler ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(result => sendResponse({ result })).catch(err => sendResponse({ error: err.message }));
  return true; // async
});

async function handleMessage({ type, payload = {} }) {
  switch (type) {
    case 'snapshot':       return snapshot(payload);
    case 'click':          return click(payload);
    case 'fill':           return fill(payload);
    case 'type':           return typeText(payload);
    case 'press':          return pressKey(payload);
    case 'scroll':         return scroll(payload);
    case 'hover':          return hover(payload);
    case 'select_option':  return selectOption(payload);
    case 'click_text':     return clickText(payload);
    case 'find_text_rect': return findTextRect(payload);
    case 'upload_file':    return uploadFile(payload);
    case 'wait':           return waitFor(payload);
    case 'find':           return findElement(payload);
    case 'page_links':     return pageLinks();
    case 'page_forms':     return pageForms();
    case 'element_state':  return elementState(payload);
    case 'dom_find':       return domFind(payload);
    case 'evaluate':       return evaluate(payload);
    case 'page_text':      return pageText();
    case 'page_html':      return pageHtml(payload);
    default:               throw new Error(`Unknown content command: ${type}`);
  }
}

// ─── Snapshot ─────────────────────────────────────────────────

function snapshot({ maxElements = 200, interactive_only = false, structure_only = false, lean = true, maxDepth } = {}) {
  // Clear previous refs
  document.querySelectorAll('[data-pilot-ref]').forEach(el => el.removeAttribute('data-pilot-ref'));
  refCounter = 0;

  const lines = [];
  const seen = new Set();
  let count = 0;

  // Lean mode: skip noise elements
  const LEAN_SKIP_TAGS = new Set(['br', 'hr', 'wbr', 'col', 'colgroup', 'thead', 'tbody', 'tfoot']);
  const LEAN_SKIP_ROLES = new Set(['separator', 'presentation', 'none']);

  function visit(el, depth) {
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

function inferRole(el) {
  const tag = el.tagName.toLowerCase();
  const type = el.type?.toLowerCase();
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

function getAccessibleName(el) {
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

function getProps(el) {
  const props = [];
  if (el.disabled) props.push('disabled');
  if (el.checked !== undefined && el.checked) props.push('checked');
  if (el.getAttribute('aria-expanded') === 'true') props.push('expanded');
  if (el.getAttribute('aria-selected') === 'true') props.push('selected');
  if (el.value && el.tagName.toLowerCase() === 'input') props.push(`value="${truncate(el.value, 40)}"`);
  return props.length ? ` [${props.join(', ')}]` : '';
}

function getDirectText(el) {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
  }
  return text.trim().replace(/\s+/g, ' ');
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// ─── Click ────────────────────────────────────────────────────

async function click({ ref, selector, x, y, button = 'left', double_click = false }) {
  const el = resolveElement(ref, selector);

  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    await sleep(50);
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    fireMouseEvent(el, 'mousedown', cx, cy, button);
    fireMouseEvent(el, 'mouseup', cx, cy, button);
    if (double_click) {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: buttonIndex(button) }));
    } else {
      el.click();
    }
    await sleep(100);
    return { clicked: ref || selector };
  } else if (x !== undefined && y !== undefined) {
    const target = document.elementFromPoint(x, y);
    if (target) {
      fireMouseEvent(target, 'mousedown', x, y, button);
      fireMouseEvent(target, 'mouseup', x, y, button);
      target.click();
      await sleep(100);
      return { clicked: `(${x}, ${y})` };
    }
  }
  throw new Error(`Element not found: ${ref || selector}`);
}

function fireMouseEvent(el, type, x, y, button = 'left') {
  el.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window,
    clientX: x, clientY: y, button: buttonIndex(button),
  }));
}

function buttonIndex(b) { return b === 'right' ? 2 : b === 'middle' ? 1 : 0; }

// ─── Fill ─────────────────────────────────────────────────────

async function fill({ ref, selector, value }) {
  const el = resolveElement(ref, selector);
  if (!el) throw new Error(`Element not found: ${ref || selector}`);

  el.focus();
  await sleep(30);

  const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

  if (nativeInputSetter) {
    nativeInputSetter.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(50);
  return { filled: ref || selector, value };
}

// ─── Type ─────────────────────────────────────────────────────

async function typeText({ text, selector, ref }) {
  if (selector || ref) {
    const el = resolveElement(ref, selector);
    if (el) el.focus();
  }

  for (const char of text) {
    const active = document.activeElement;
    active?.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    active?.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));

    if (active && 'value' in active) {
      active.value += char;
      active.dispatchEvent(new Event('input', { bubbles: true }));
    }

    active?.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await sleep(20);
  }
  return { typed: text.length + ' chars' };
}

// ─── Press Key ────────────────────────────────────────────────

async function pressKey({ key }) {
  const active = document.activeElement || document.body;
  const eventInit = { key, bubbles: true, cancelable: true };

  // Map common Playwright key names
  const keyMap = {
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
    active.submit();
  } else if (mappedKey === 'Enter') {
    active.dispatchEvent(new Event('submit', { bubbles: true }));
  }

  await sleep(50);
  return { pressed: key };
}

// ─── Scroll ───────────────────────────────────────────────────

async function scroll({ ref, selector, deltaX = 0, deltaY = 300, x, y }) {
  if (ref || selector) {
    const el = resolveElement(ref, selector);
    if (el) {
      el.scrollBy({ left: deltaX, top: deltaY, behavior: 'smooth' });
      await sleep(300);
      return { scrolled: ref || selector };
    }
  }
  window.scrollBy({ left: x ?? deltaX, top: y ?? deltaY, behavior: 'smooth' });
  await sleep(300);
  return { scrolled: 'window' };
}

// ─── Evaluate ─────────────────────────────────────────────────

async function evaluate({ script }) {
  // eslint-disable-next-line no-eval
  const result = eval(script);
  return { result: typeof result === 'object' ? JSON.stringify(result) : String(result ?? '') };
}

// ─── Page Text / HTML ─────────────────────────────────────────

function pageText() {
  const text = document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 8000);
  return { text, url: location.href, title: document.title };
}

function pageHtml({ selector } = {}) {
  if (selector) {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Selector not found: ${selector}`);
    return { html: el.innerHTML };
  }
  return { html: document.documentElement.outerHTML.slice(0, 50000) };
}

// ─── Hover ───────────────────────────────────────────────────

async function hover({ ref, selector }) {
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
  return { hovered: ref || selector };
}

// ─── Select Option ───────────────────────────────────────────

async function selectOption({ ref, selector, value, label }) {
  const el = resolveElement(ref, selector);
  if (!el) throw new Error(`Element not found: ${ref || selector}`);
  if (el.tagName.toLowerCase() !== 'select') throw new Error('Element is not a <select>');

  let option;
  if (label) {
    option = Array.from(el.options).find(o => o.textContent.trim() === label);
  } else if (value !== undefined) {
    option = Array.from(el.options).find(o => o.value === value);
  }
  if (!option) throw new Error(`Option not found: ${label || value}`);

  el.value = option.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(50);
  return { selected: option.textContent.trim(), value: option.value };
}

// ─── Text Click (for portal-rendered custom dropdowns) ─────────

async function clickText({ text, exact = true, selector }) {
  const target = await getTextClickTarget({ text, exact, selector });

  fireMouseEvent(target.el, 'mousedown', target.x, target.y, 'left');
  fireMouseEvent(target.el, 'mouseup', target.x, target.y, 'left');
  target.el.click();
  await sleep(100);
  return { clicked: text };
}

async function findTextRect({ text, exact = true, selector }) {
  const target = await getTextClickTarget({ text, exact, selector });
  return {
    text: normalizeText(target.el.innerText || target.el.textContent || ''),
    tag: target.el.tagName.toLowerCase(),
    role: target.el.getAttribute('role') || null,
    x: target.x,
    y: target.y,
  };
}

async function getTextClickTarget({ text, exact = true, selector }) {
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

function findVisibleTextElement(root, text, exact) {
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
      const candidateText = normalizeText(el.innerText || el.textContent || '');
      return exact ? candidateText === normalizedTarget : candidateText.includes(normalizedTarget);
    })
    .sort((a, b) => scoreTextMatchCandidate(b, normalizedTarget) - scoreTextMatchCandidate(a, normalizedTarget));

  return matches[0] || null;
}

function domFind({ text, selector, exact = false, visibleOnly = true, limit = 20 } = {}) {
  const root = selector ? document.querySelector(selector) : document;
  if (!root) throw new Error(`Selector not found: ${selector}`);

  const candidates = collectDomElements(root)
    .filter(el => !visibleOnly || isVisible(el))
    .filter(el => {
      if (!text) return true;
      const candidateText = normalizeText(el.innerText || el.textContent || '');
      const targetText = normalizeText(text);
      return exact ? candidateText === targetText : candidateText.includes(targetText);
    })
    .sort((a, b) => scoreDomFindCandidate(b, text) - scoreDomFindCandidate(a, text))
    .slice(0, Math.max(1, Math.min(limit, 100)))
    .map(describeElement);

  return { matches: candidates, count: candidates.length };
}

function collectDomElements(root) {
  const out = [];
  const visit = (node) => {
    if (!node) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      out.push(node);
      if (node.shadowRoot) visit(node.shadowRoot);
    }
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return out;
}

function scoreDomFindCandidate(el, text) {
  const clickTarget = findClickableAncestor(el) || el;
  let score = scoreTextClickCandidate(clickTarget);
  const tag = el.tagName;
  if (['HTML', 'BODY', 'SCRIPT', 'STYLE'].includes(tag)) score -= 100;
  if (text) {
    const candidateText = normalizeText(el.innerText || el.textContent || '');
    const targetText = normalizeText(text);
    if (candidateText === targetText) score += 60;
    score -= Math.min(40, Math.max(0, candidateText.length - targetText.length) / 5);
  }
  return score;
}

function describeElement(el) {
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
    text: normalizeText(el.innerText || el.textContent || '').slice(0, 200),
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

function cssPath(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = [];
  let current = el;
  while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
    let part = current.tagName.toLowerCase();
    const classes = typeof current.className === 'string'
      ? current.className.trim().split(/\s+/).filter(Boolean).slice(0, 3)
      : [];
    if (classes.length) part += classes.map(cls => `.${CSS.escape(cls)}`).join('');
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(child => child.tagName === current.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parent;
  }
  return parts.length ? parts.join(' > ') : current?.tagName?.toLowerCase() || '';
}

function findClickableAncestor(el) {
  const candidates = [];
  let current = el;
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

function scoreTextMatchCandidate(el, normalizedTarget) {
  const candidateText = normalizeText(el.innerText || el.textContent || '');
  const clickTarget = findClickableAncestor(el) || el;
  let score = scoreTextClickCandidate(clickTarget);
  if (candidateText === normalizedTarget) score += 80;
  score -= Math.min(40, Math.max(0, candidateText.length - normalizedTarget.length) / 4);
  if (el !== clickTarget) score += 10;
  return score;
}

function scoreTextClickCandidate(el) {
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

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

// ─── File Upload ─────────────────────────────────────────────

async function uploadFile({ ref, selector, files }) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('No files provided');
  }

  const input = resolveElement(ref, selector) || findBestFileInput(files);
  if (!input) throw new Error('No file input found');
  if (input.tagName.toLowerCase() !== 'input' || input.type !== 'file') {
    throw new Error('Not a file input');
  }

  const dt = new DataTransfer();
  for (const file of files) {
    const bytes = base64ToUint8Array(file.data);
    dt.items.add(new File([bytes], file.name, {
      type: file.mimeType || 'application/octet-stream',
      lastModified: file.lastModified || Date.now(),
    }));
  }

  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(100);

  return {
    uploaded: files.map(file => ({ name: file.name, size: file.size })),
    count: files.length,
  };
}

function findBestFileInput(files) {
  const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
  if (inputs.length === 0) return null;
  if (inputs.length === 1) return inputs[0];

  const extensions = files
    .map(file => '.' + String(file.name || '').split('.').pop().toLowerCase())
    .filter(ext => ext.length > 1);

  return inputs
    .map(input => ({ input, score: scoreFileInput(input, extensions) }))
    .sort((a, b) => b.score - a.score)[0].input;
}

function scoreFileInput(input, extensions) {
  let score = 0;
  const accept = String(input.getAttribute('accept') || '').toLowerCase();
  for (const ext of extensions) {
    if (accept.includes(ext)) score += 20;
  }
  if (accept.includes('pdf')) score += 5;
  if (isVisible(input)) score += 3;
  return score;
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── Wait ────────────────────────────────────────────────────

async function waitFor({ selector, text, timeout = 10000 }) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (selector && document.querySelector(selector)) return { found: selector };
    if (text && document.body.innerText.includes(text)) return { found: text };
    await sleep(200);
  }
  throw new Error(`Timeout waiting for ${selector || text} after ${timeout}ms`);
}

// ─── Find Element ────────────────────────────────────────────

function findElement({ text, label, role, placeholder }) {
  let el;
  if (label) {
    const labelEl = Array.from(document.querySelectorAll('label')).find(l => l.textContent.trim().includes(label));
    if (labelEl?.htmlFor) el = document.getElementById(labelEl.htmlFor);
    if (!el && labelEl) el = labelEl.querySelector('input, select, textarea');
  }
  if (!el && placeholder) {
    el = document.querySelector(`[placeholder*="${placeholder}"]`);
  }
  if (!el && role) {
    el = document.querySelector(`[role="${role}"]`);
    if (!el) {
      const roleMap = { button: 'button', link: 'a', textbox: 'input' };
      if (roleMap[role]) el = text
        ? Array.from(document.querySelectorAll(roleMap[role])).find(e => e.textContent.trim().includes(text))
        : document.querySelector(roleMap[role]);
    }
  }
  if (!el && text) {
    const all = document.querySelectorAll('a, button, [role="button"], [role="link"], input[type="submit"]');
    el = Array.from(all).find(e => e.textContent.trim().includes(text));
  }
  if (!el) throw new Error(`Element not found: ${text || label || role || placeholder}`);

  // Assign a ref
  refCounter++;
  const refId = `e${refCounter}`;
  el.setAttribute('data-pilot-ref', refId);
  const name = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 80) || '';
  return { ref: `@${refId}`, tag: el.tagName.toLowerCase(), text: name };
}

// ─── Page Links ──────────────────────────────────────────────

function pageLinks() {
  const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map(a => ({
    text: a.textContent.trim().slice(0, 80),
    href: a.href,
  }));
  return { links, count: links.length };
}

// ─── Page Forms ──────────────────────────────────────────────

function pageForms() {
  const forms = Array.from(document.querySelectorAll('form')).map((form, i) => {
    const fields = Array.from(form.querySelectorAll('input, select, textarea')).map(el => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      name: el.name || null,
      id: el.id || null,
      placeholder: el.placeholder || null,
      value: el.type === 'password' ? '****' : (el.value || null),
    }));
    return { index: i, action: form.action, method: form.method, fields };
  });
  return { forms, count: forms.length };
}

// ─── Element State ───────────────────────────────────────────

function elementState({ ref, selector }) {
  const el = resolveElement(ref, selector);
  if (!el) throw new Error(`Element not found: ${ref || selector}`);
  const rect = el.getBoundingClientRect();
  const visible = isVisible(el);
  return {
    visible,
    enabled: !el.disabled,
    checked: el.checked ?? null,
    focused: document.activeElement === el,
    tag: el.tagName.toLowerCase(),
    text: el.textContent?.trim().slice(0, 80) || '',
  };
}

// ─── Helpers ──────────────────────────────────────────────────

function resolveElement(ref, selector) {
  if (ref && ref.startsWith('@')) {
    return document.querySelector(`[data-pilot-ref="${ref.slice(1)}"]`);
  }
  if (selector) return document.querySelector(selector);
  return null;
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
