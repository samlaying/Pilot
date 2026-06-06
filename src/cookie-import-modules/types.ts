/**
 * Cookie import — type definitions and error class.
 */

export interface BrowserInfo {
  name: string;
  dataDir: string;
  keychainService: string;
  aliases: string[];
  linuxDataDir?: string;
  linuxApplication?: string;
}

export interface ImportResult {
  cookies: PlaywrightCookie[];
  count: number;
  failed: number;
  domainCounts: Record<string, number>;
}

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export class CookieImportError extends Error {
  constructor(
    message: string,
    public code: string,
    public action?: 'retry',
  ) {
    super(message);
    this.name = 'CookieImportError';
  }
}

export type BrowserPlatform = 'darwin' | 'linux';

export interface BrowserMatch {
  browser: BrowserInfo;
  platform: BrowserPlatform;
  dbPath: string;
}

export interface RawCookie {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Buffer | Uint8Array;
  path: string;
  expires_utc: number | bigint;
  is_secure: number;
  is_httponly: number;
  has_expires: number;
  samesite: number;
}
