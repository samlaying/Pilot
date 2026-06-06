/**
 * Cookie import — browser registry, resolution, and profile listing.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { BrowserInfo, BrowserMatch, BrowserPlatform } from './types.js';
import { CookieImportError } from './types.js';

// ─── Browser Registry ───────────────────────────────────────────

export const BROWSER_REGISTRY: BrowserInfo[] = [
  { name: 'Comet',    dataDir: 'Comet/',                         keychainService: 'Comet Safe Storage',          aliases: ['comet', 'perplexity'] },
  { name: 'Chrome',   dataDir: 'Google/Chrome/',                 keychainService: 'Chrome Safe Storage',         aliases: ['chrome', 'google-chrome'], linuxDataDir: 'google-chrome/', linuxApplication: 'chrome' },
  { name: 'Chromium', dataDir: 'chromium/',                      keychainService: 'Chromium Safe Storage',       aliases: ['chromium'], linuxDataDir: 'chromium/', linuxApplication: 'chromium' },
  { name: 'Arc',      dataDir: 'Arc/User Data/',                 keychainService: 'Arc Safe Storage',            aliases: ['arc'] },
  { name: 'Brave',    dataDir: 'BraveSoftware/Brave-Browser/',   keychainService: 'Brave Safe Storage',          aliases: ['brave'], linuxDataDir: 'BraveSoftware/Brave-Browser/', linuxApplication: 'brave' },
  { name: 'Edge',     dataDir: 'Microsoft Edge/',                keychainService: 'Microsoft Edge Safe Storage', aliases: ['edge'], linuxDataDir: 'microsoft-edge/', linuxApplication: 'microsoft-edge' },
];

// ─── Platform Helpers ───────────────────────────────────────────

export function getHostPlatform(): BrowserPlatform | null {
  if (process.platform === 'darwin' || process.platform === 'linux') return process.platform;
  return null;
}

export function getSearchPlatforms(): BrowserPlatform[] {
  const current = getHostPlatform();
  const order: BrowserPlatform[] = [];
  if (current) order.push(current);
  for (const platform of ['darwin', 'linux'] as BrowserPlatform[]) {
    if (!order.includes(platform)) order.push(platform);
  }
  return order;
}

export function getDataDirForPlatform(browser: BrowserInfo, platform: BrowserPlatform): string | null {
  return platform === 'darwin' ? browser.dataDir : browser.linuxDataDir || null;
}

export function getBaseDir(platform: BrowserPlatform): string {
  return platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : path.join(os.homedir(), '.config');
}

// ─── Input Sanitization ────────────────────────────────────────

export function sanitizeBrowserName(browserName: string): string {
  return browserName
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .trim() || 'unknown';
}

export function validateProfile(profile: string): void {
  if (/[/\\]|\.\./.test(profile) || /[\x00-\x1f]/.test(profile)) {
    throw new CookieImportError(`Invalid profile name: '${profile}'`, 'bad_request');
  }
}

// ─── Browser Resolution ────────────────────────────────────────

export function resolveBrowser(nameOrAlias: string): BrowserInfo {
  const needle = nameOrAlias.toLowerCase().trim();
  const found = BROWSER_REGISTRY.find(b =>
    b.aliases.includes(needle) || b.name.toLowerCase() === needle
  );
  if (!found) {
    const supported = BROWSER_REGISTRY.flatMap(b => b.aliases).join(', ');
    throw new CookieImportError(
      `Unknown browser '${nameOrAlias}'. Supported: ${supported}`,
      'unknown_browser',
    );
  }
  return found;
}

export function findBrowserMatch(browser: BrowserInfo, profile: string): BrowserMatch | null {
  validateProfile(profile);
  for (const platform of getSearchPlatforms()) {
    const dataDir = getDataDirForPlatform(browser, platform);
    if (!dataDir) continue;
    const dbPath = path.join(getBaseDir(platform), dataDir, profile, 'Cookies');
    try {
      if (fs.existsSync(dbPath)) {
        return { browser, platform, dbPath };
      }
    } catch {}
  }
  return null;
}

export function getBrowserMatch(browser: BrowserInfo, profile: string): BrowserMatch {
  const match = findBrowserMatch(browser, profile);
  if (match) return match;

  const attempted = getSearchPlatforms()
    .map(platform => {
      const dataDir = getDataDirForPlatform(browser, platform);
      return dataDir ? path.join(getBaseDir(platform), dataDir, profile, 'Cookies') : null;
    })
    .filter((entry): entry is string => entry !== null);

  throw new CookieImportError(
    `${browser.name} is not installed (no cookie database at ${attempted.join(' or ')})`,
    'not_installed',
  );
}

// ─── Discovery ─────────────────────────────────────────────────

export function findInstalledBrowsers(): BrowserInfo[] {
  return BROWSER_REGISTRY.filter(browser => {
    if (findBrowserMatch(browser, 'Default') !== null) return true;
    for (const platform of getSearchPlatforms()) {
      const dataDir = getDataDirForPlatform(browser, platform);
      if (!dataDir) continue;
      const browserDir = path.join(getBaseDir(platform), dataDir);
      try {
        const entries = fs.readdirSync(browserDir, { withFileTypes: true });
        if (entries.some(e =>
          e.isDirectory() && e.name.startsWith('Profile ') &&
          fs.existsSync(path.join(browserDir, e.name, 'Cookies'))
        )) return true;
      } catch {}
    }
    return false;
  });
}

export function listSupportedBrowserNames(): string[] {
  const hostPlatform = getHostPlatform();
  return BROWSER_REGISTRY
    .filter(browser => hostPlatform ? getDataDirForPlatform(browser, hostPlatform) !== null : true)
    .map(browser => browser.name);
}

export function listProfiles(browserName: string): Array<{ name: string; displayName: string }> {
  const browser = resolveBrowser(browserName);
  const profiles: Array<{ name: string; displayName: string }> = [];

  for (const platform of getSearchPlatforms()) {
    const dataDir = getDataDirForPlatform(browser, platform);
    if (!dataDir) continue;
    const browserDir = path.join(getBaseDir(platform), dataDir);
    if (!fs.existsSync(browserDir)) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(browserDir, { withFileTypes: true });
    } catch { continue; }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name !== 'Default' && !entry.name.startsWith('Profile ')) continue;
      const cookiePath = path.join(browserDir, entry.name, 'Cookies');
      if (!fs.existsSync(cookiePath)) continue;
      if (profiles.some(p => p.name === entry.name)) continue;

      let displayName = entry.name;
      try {
        const prefsPath = path.join(browserDir, entry.name, 'Preferences');
        if (fs.existsSync(prefsPath)) {
          const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
          const email = prefs?.account_info?.[0]?.email;
          if (email && typeof email === 'string') {
            displayName = email;
          } else {
            const profileName = prefs?.profile?.name;
            if (profileName && typeof profileName === 'string') {
              displayName = profileName;
            }
          }
        }
      } catch {}

      profiles.push({ name: entry.name, displayName });
    }
    if (profiles.length > 0) break;
  }
  return profiles;
}
