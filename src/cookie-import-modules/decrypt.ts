/**
 * Cookie import — SQLite access, cookie decryption, and Chromium epoch conversion.
 */

import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { RawCookie, PlaywrightCookie, BrowserMatch } from './types.js';
import { CookieImportError } from './types.js';
import { getDerivedKeys } from './keychain.js';
import { sanitizeBrowserName } from './registry.js';

// ─── Chromium Epoch ────────────────────────────────────────────

const CHROMIUM_EPOCH_OFFSET = 11644473600000000n;

export function chromiumNow(): bigint {
  return BigInt(Date.now()) * 1000n + CHROMIUM_EPOCH_OFFSET;
}

function chromiumEpochToUnix(epoch: number | bigint, hasExpires: number): number {
  if (hasExpires === 0 || epoch === 0 || epoch === 0n) return -1;
  const epochBig = BigInt(epoch);
  const unixMicro = epochBig - CHROMIUM_EPOCH_OFFSET;
  return Number(unixMicro / 1000000n);
}

function mapSameSite(value: number): 'Strict' | 'Lax' | 'None' {
  switch (value) {
    case 0: return 'None';
    case 1: return 'Lax';
    case 2: return 'Strict';
    default: return 'Lax';
  }
}

// ─── SQLite Access ─────────────────────────────────────────────

export function openDb(dbPath: string, browserName: string): Database.Database {
  try {
    return new Database(dbPath, { readonly: true });
  } catch (err: any) {
    if (err.message?.includes('SQLITE_BUSY') || err.message?.includes('database is locked')) {
      return openDbFromCopy(dbPath, browserName);
    }
    if (err.message?.includes('SQLITE_CORRUPT') || err.message?.includes('malformed')) {
      throw new CookieImportError(`Cookie database for ${browserName} is corrupt`, 'db_corrupt');
    }
    throw err;
  }
}

function openDbFromCopy(dbPath: string, browserName: string): Database.Database {
  const tmpPath = path.join(os.tmpdir(), `pilot-cookies-${sanitizeBrowserName(browserName)}-${crypto.randomUUID()}.db`);
  try {
    fs.copyFileSync(dbPath, tmpPath);
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    if (fs.existsSync(walPath)) fs.copyFileSync(walPath, tmpPath + '-wal');
    if (fs.existsSync(shmPath)) fs.copyFileSync(shmPath, tmpPath + '-shm');

    const db = new Database(tmpPath, { readonly: true });
    const origClose = db.close.bind(db);
    (db as any).close = () => {
      origClose();
      try { fs.unlinkSync(tmpPath); } catch {}
      try { fs.unlinkSync(tmpPath + '-wal'); } catch {}
      try { fs.unlinkSync(tmpPath + '-shm'); } catch {}
    };
    return db;
  } catch {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw new CookieImportError(
      `Cookie database is locked (${browserName} may be running). Try closing ${browserName} first.`,
      'db_locked',
      'retry',
    );
  }
}

// ─── Cookie Decryption ────────────────────────────────────────

export function decryptCookieValue(row: RawCookie, keys: Map<string, Buffer>): string {
  if (row.value && row.value.length > 0) return row.value;

  const ev = Buffer.from(row.encrypted_value);
  if (ev.length === 0) return '';

  const prefix = ev.slice(0, 3).toString('utf-8');
  const key = keys.get(prefix);
  if (!key) throw new Error(`No decryption key available for ${prefix} cookies`);

  const ciphertext = ev.slice(3);
  const iv = Buffer.alloc(16, 0x20);
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  if (plaintext.length <= 32) return '';
  return plaintext.slice(32).toString('utf-8');
}

export function toPlaywrightCookie(row: RawCookie, value: string): PlaywrightCookie {
  return {
    name: row.name,
    value,
    domain: row.host_key,
    path: row.path || '/',
    expires: chromiumEpochToUnix(row.expires_utc, row.has_expires),
    secure: row.is_secure === 1,
    httpOnly: row.is_httponly === 1,
    sameSite: mapSameSite(row.samesite),
  };
}
