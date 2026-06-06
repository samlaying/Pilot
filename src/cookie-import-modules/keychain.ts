/**
 * Cookie import — macOS Keychain / Linux libsecret access and key derivation.
 */

import * as crypto from 'crypto';
import { spawn } from 'child_process';
import type { BrowserInfo, BrowserMatch, BrowserPlatform } from './types.js';
import { CookieImportError } from './types.js';

// ─── Key Derivation ────────────────────────────────────────────

function deriveKey(password: string, iterations: number): Buffer {
  return crypto.pbkdf2Sync(password, 'saltysalt', iterations, 16, 'sha1');
}

const keyCache = new Map<string, Buffer>();

function getCachedDerivedKey(cacheKey: string, password: string, iterations: number): Buffer {
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  const derived = deriveKey(password, iterations);
  keyCache.set(cacheKey, derived);
  return derived;
}

export async function getDerivedKeys(match: BrowserMatch): Promise<Map<string, Buffer>> {
  if (match.platform === 'darwin') {
    const password = await getMacKeychainPassword(match.browser.keychainService);
    return new Map([
      ['v10', getCachedDerivedKey(`darwin:${match.browser.keychainService}:v10`, password, 1003)],
    ]);
  }

  const keys = new Map<string, Buffer>();
  keys.set('v10', getCachedDerivedKey('linux:v10', 'peanuts', 1));

  const linuxPassword = await getLinuxSecretPassword(match.browser);
  if (linuxPassword) {
    keys.set('v11', getCachedDerivedKey(`linux:${match.browser.keychainService}:v11`, linuxPassword, 1));
  }
  return keys;
}

// ─── macOS Keychain ────────────────────────────────────────────

async function getMacKeychainPassword(service: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn('security', ['find-generic-password', '-s', service, '-w'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new CookieImportError(
        `macOS is waiting for Keychain permission. Look for a dialog asking to allow access to "${service}".`,
        'keychain_timeout',
        'retry',
      ));
    }, 10_000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const errText = stderr.trim().toLowerCase();
        if (errText.includes('user canceled') || errText.includes('denied') || errText.includes('interaction not allowed')) {
          reject(new CookieImportError(
            `Keychain access denied. Click "Allow" in the macOS dialog for "${service}".`,
            'keychain_denied',
            'retry',
          ));
          return;
        }
        if (errText.includes('could not be found') || errText.includes('not found')) {
          reject(new CookieImportError(
            `No Keychain entry for "${service}". Is this a Chromium-based browser?`,
            'keychain_not_found',
          ));
          return;
        }
        reject(new CookieImportError(`Could not read Keychain: ${stderr.trim()}`, 'keychain_error', 'retry'));
        return;
      }
      resolve(stdout.trim());
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new CookieImportError(`Could not read Keychain: ${err.message}`, 'keychain_error', 'retry'));
    });
  });
}

// ─── Linux libsecret ───────────────────────────────────────────

async function getLinuxSecretPassword(browser: BrowserInfo): Promise<string | null> {
  const attempts: string[][] = [
    ['secret-tool', 'lookup', 'Title', browser.keychainService],
  ];
  if (browser.linuxApplication) {
    attempts.push(
      ['secret-tool', 'lookup', 'xdg:schema', 'chrome_libsecret_os_crypt_password_v2', 'application', browser.linuxApplication],
      ['secret-tool', 'lookup', 'xdg:schema', 'chrome_libsecret_os_crypt_password', 'application', browser.linuxApplication],
    );
  }
  for (const cmd of attempts) {
    const password = await runPasswordLookup(cmd, 3_000);
    if (password) return password;
  }
  return null;
}

async function runPasswordLookup(cmd: string[], timeoutMs: number): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    try {
      const proc = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });

      const timer = setTimeout(() => {
        proc.kill();
        resolve(null);
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) { resolve(null); return; }
        const password = stdout.trim();
        resolve(password.length > 0 ? password : null);
      });

      proc.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}
