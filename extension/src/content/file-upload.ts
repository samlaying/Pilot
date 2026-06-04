/**
 * File upload handling for input[type="file"] elements.
 */

import { resolveElement, isVisible, sleep } from './utils';

export interface UploadFile {
  name: string;
  data: string;
  mimeType?: string;
  size?: number;
  lastModified?: number;
}

export interface UploadFileOptions {
  ref?: string;
  selector?: string;
  files: UploadFile[];
}

export async function uploadFile(opts: UploadFileOptions): Promise<{
  uploaded: Array<{ name: string; size?: number }>;
  count: number;
}> {
  const { ref, selector, files } = opts;
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('No files provided');
  }

  const input = resolveElement(ref, selector) || findBestFileInput(files);
  if (!input) throw new Error('No file input found');
  if (input.tagName.toLowerCase() !== 'input' || (input as HTMLInputElement).type !== 'file') {
    throw new Error('Not a file input');
  }

  const dt = new DataTransfer();
  for (const file of files) {
    const bytes = base64ToUint8Array(file.data);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    dt.items.add(new File([buffer], file.name, {
      type: file.mimeType || 'application/octet-stream',
      lastModified: file.lastModified || Date.now(),
    }));
  }

  (input as HTMLInputElement).files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(100);

  return {
    uploaded: files.map(file => ({ name: file.name, size: file.size })),
    count: files.length,
  };
}

/** Find the best file input element based on file extensions and visibility. */
export function findBestFileInput(files: UploadFile[]): HTMLInputElement | null {
  const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
  if (inputs.length === 0) return null;
  if (inputs.length === 1) return inputs[0];

  const extensions = files
    .map(file => '.' + String(file.name || '').split('.').pop()?.toLowerCase())
    .filter(ext => ext && ext.length > 1);

  return inputs
    .map(input => ({ input, score: scoreFileInput(input, extensions) }))
    .sort((a, b) => b.score - a.score)[0].input;
}

/** Score a file input based on accepted extensions and visibility. */
export function scoreFileInput(input: HTMLInputElement, extensions: string[]): number {
  let score = 0;
  const accept = String(input.getAttribute('accept') || '').toLowerCase();
  for (const ext of extensions) {
    if (accept.includes(ext)) score += 20;
  }
  if (accept.includes('pdf')) score += 5;
  if (isVisible(input)) score += 3;
  return score;
}

/** Decode a base64 string into a Uint8Array. */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
