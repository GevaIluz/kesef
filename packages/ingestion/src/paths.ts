import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export function kesefDir(): string {
  const d = join(homedir(), '.kesef');
  mkdirSync(d, { recursive: true });
  return d;
}

export function dbPath(): string {
  return join(kesefDir(), 'kesef.db');
}
