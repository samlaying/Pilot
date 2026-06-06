/**
 * Page content extraction: evaluate JS, get text/HTML, extract links and forms.
 */

export interface EvaluateOptions {
  script: string;
}

export async function evaluate(opts: EvaluateOptions): Promise<{ result: string }> {
  // eslint-disable-next-line no-eval
  const result = eval(opts.script);
  return { result: typeof result === 'object' ? JSON.stringify(result) : String(result ?? '') };
}

export function pageText(): { text: string; url: string; title: string } {
  const text = document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 8000);
  return { text, url: location.href, title: document.title };
}

export interface PageHtmlOptions {
  selector?: string;
  maxChars?: number;
}

export function pageHtml(opts: PageHtmlOptions = {}): { html: string } {
  const { selector, maxChars = 50_000 } = opts;
  if (selector) {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Selector not found: ${selector}`);
    return { html: el.innerHTML.slice(0, maxChars) };
  }
  return { html: document.documentElement.outerHTML.slice(0, maxChars) };
}

export function pageLinks(): { links: Array<{ text: string; href: string }>; count: number } {
  const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map(a => ({
    text: a.textContent?.trim().slice(0, 80) || '',
    href: (a as HTMLAnchorElement).href,
  }));
  return { links, count: links.length };
}

export function pageForms(): { forms: Array<{ index: number; action: string; method: string; fields: any[] }>; count: number } {
  const forms = Array.from(document.querySelectorAll('form')).map((form, i) => {
    const fields = Array.from(form.querySelectorAll('input, select, textarea')).map(el => ({
      tag: el.tagName.toLowerCase(),
      type: (el as HTMLInputElement).type || null,
      name: (el as HTMLInputElement).name || null,
      id: el.id || null,
      placeholder: (el as HTMLInputElement).placeholder || null,
      value: (el as HTMLInputElement).type === 'password' ? '****' : ((el as HTMLInputElement).value || null),
    }));
    return { index: i, action: (form as HTMLFormElement).action, method: (form as HTMLFormElement).method, fields };
  });
  return { forms, count: forms.length };
}
