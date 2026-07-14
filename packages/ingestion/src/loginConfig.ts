import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { kesefDir } from './paths.js';

// Per-source login entry URL. kesef types nothing and only waits for the post-login URL, so pointing a
// source at its QR / app-login page lets you sign in with your phone instead of a username+password.
// A URL is not a secret (no credential is ever stored here) — plain JSON in ~/.kesef is fine.
export type LoginSource = 'beinleumi' | 'cal';
const cfgPath = () => join(kesefDir(), 'logins.json');

function readAll(): Record<string, string> {
  try {
    const j = JSON.parse(readFileSync(cfgPath(), 'utf8'));
    return (j && typeof j === 'object') ? j as Record<string, string> : {};
  } catch { return {}; }
}

/** The user-configured login URL for a source, or undefined to use the library default. */
export function loginUrlFor(source: LoginSource): string | undefined {
  const u = readAll()[source];
  return typeof u === 'string' && u.trim() ? u.trim() : undefined;
}

export function setLoginUrl(source: LoginSource, url: string): void {
  const all = readAll();
  all[source] = url;
  mkdirSync(kesefDir(), { recursive: true });
  writeFileSync(cfgPath(), JSON.stringify(all, null, 2));
}
