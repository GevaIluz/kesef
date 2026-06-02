import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { CategoryCode } from '@kesef/core';

/** Load ~/.kesef/categories.json: { "merchant substring": "categoryCode", ... }. Missing/invalid → {}. */
export function loadOverrides(): Record<string, CategoryCode> {
  const path = join(homedir(), '.kesef', 'categories.json');
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, CategoryCode> : {};
  } catch { return {}; }
}
