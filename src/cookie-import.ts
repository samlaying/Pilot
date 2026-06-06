/**
 * Chromium browser cookie import — read and decrypt cookies from real browsers.
 * Ported from gstack browse/src/cookie-import-browser.ts.
 *
 * Changes from gstack:
 *   - bun:sqlite → better-sqlite3
 *   - Bun.spawn → child_process.spawn/execSync
 *   - Removed picker UI (MCP uses direct import)
 *
 * Internal modules split into: types, registry, keychain, decrypt.
 */

export type { BrowserInfo, ImportResult, PlaywrightCookie } from './cookie-import-modules/types.js';
export { CookieImportError } from './cookie-import-modules/types.js';
export {
  findInstalledBrowsers,
  listSupportedBrowserNames,
  listProfiles,
  sanitizeBrowserName,
} from './cookie-import-modules/registry.js';

import type { ImportResult, RawCookie } from './cookie-import-modules/types.js';
import { resolveBrowser, getBrowserMatch } from './cookie-import-modules/registry.js';
import { getDerivedKeys } from './cookie-import-modules/keychain.js';
import { openDb, decryptCookieValue, toPlaywrightCookie, chromiumNow } from './cookie-import-modules/decrypt.js';

export function listDomains(browserName: string, profile = 'Default') {
  const browser = resolveBrowser(browserName);
  const match = getBrowserMatch(browser, profile);
  const db = openDb(match.dbPath, browser.name);
  try {
    const now = chromiumNow();
    const rows = db.prepare(
      `SELECT host_key AS domain, COUNT(*) AS count
       FROM cookies
       WHERE has_expires = 0 OR expires_utc > ?
       GROUP BY host_key
       ORDER BY count DESC`
    ).all(now.toString()) as Array<{ domain: string; count: number }>;
    return { domains: rows, browser: browser.name };
  } finally {
    db.close();
  }
}

export async function importCookies(
  browserName: string,
  domains: string[],
  profile = 'Default',
  maxCookies = 0,
): Promise<ImportResult> {
  const browser = resolveBrowser(browserName);
  const match = getBrowserMatch(browser, profile);
  const derivedKeys = await getDerivedKeys(match);
  const db = openDb(match.dbPath, browser.name);

  try {
    const now = chromiumNow();
    let rows: RawCookie[];

    if (domains.length > 0) {
      const placeholders = domains.map(() => '?').join(',');
      const stmt = db.prepare(
        `SELECT host_key, name, value, encrypted_value, path, expires_utc,
                is_secure, is_httponly, has_expires, samesite
         FROM cookies
         WHERE host_key IN (${placeholders})
           AND (has_expires = 0 OR expires_utc > ?)
         ORDER BY host_key, name`
      );
      rows = stmt.all(...domains, now.toString()) as RawCookie[];
    } else {
      const limit = maxCookies > 0 ? maxCookies : 500;
      const stmt = db.prepare(
        `SELECT host_key, name, value, encrypted_value, path, expires_utc,
                is_secure, is_httponly, has_expires, samesite
         FROM cookies
         WHERE (has_expires = 0 OR expires_utc > ?)
         ORDER BY expires_utc DESC
         LIMIT ?`
      );
      rows = stmt.all(now.toString(), limit) as RawCookie[];
    }

    const cookies: ImportResult['cookies'] = [];
    let failed = 0;
    const domainCounts: Record<string, number> = {};

    for (const row of rows) {
      try {
        const value = decryptCookieValue(row, derivedKeys);
        const cookie = toPlaywrightCookie(row, value);
        cookies.push(cookie);
        domainCounts[row.host_key] = (domainCounts[row.host_key] || 0) + 1;
      } catch {
        failed++;
      }
    }

    return { cookies, count: cookies.length, failed, domainCounts };
  } finally {
    db.close();
  }
}
