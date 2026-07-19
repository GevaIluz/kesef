import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { kesefDir } from './paths.js';

// Per-source login entry URL. kesef types nothing and only waits for the post-login URL, so pointing a
// source at its QR / app-login page lets you sign in with your phone instead of a username+password.
// A URL is not a secret (no credential is ever stored here) — plain JSON in ~/.kesef is fine.
export type LoginSource = 'beinleumi' | 'cal';
const cfgPath = () => join(kesefDir(), 'logins.json');

// Sensible defaults so phone/QR login works out of the box — no per-machine setup. Beinleumi's
// private-banking entry offers "sign in with the app" (QR) instead of a typed password. An explicit
// entry in logins.json always wins (including "" to force the library's default password page).
const DEFAULT_LOGIN_URL: Partial<Record<LoginSource, string>> = {
  beinleumi: 'https://www.fibi.co.il/private/',
};

function readAll(): Record<string, string> {
  try {
    const j = JSON.parse(readFileSync(cfgPath(), 'utf8'));
    return (j && typeof j === 'object') ? j as Record<string, string> : {};
  } catch { return {}; }
}

/** The login URL for a source: explicit config wins; else the built-in QR default; else undefined
 *  (library default password page). `source in all` lets an explicit "" opt back out of the default. */
export function loginUrlFor(source: LoginSource): string | undefined {
  const all = readAll();
  if (source in all) {
    const u = all[source];
    return typeof u === 'string' && u.trim() ? u.trim() : undefined;
  }
  return DEFAULT_LOGIN_URL[source];
}

export function setLoginUrl(source: LoginSource, url: string): void {
  const all = readAll();
  all[source] = url;
  mkdirSync(kesefDir(), { recursive: true });
  writeFileSync(cfgPath(), JSON.stringify(all, null, 2));
}
