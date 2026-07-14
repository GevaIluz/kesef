import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { kesefDir } from './paths.js';

/** Where the user's IBI portfolio total lives, learned once so future syncs read it automatically. */
export interface IbiConfig { url?: string; selector?: string }

const cfgPath = () => join(kesefDir(), 'ibi.json');

export function loadIbiConfig(): IbiConfig {
  try {
    const j = JSON.parse(readFileSync(cfgPath(), 'utf8'));
    return (j && typeof j === 'object') ? j as IbiConfig : {};
  } catch { return {}; }
}

export function saveIbiConfig(cfg: IbiConfig): void {
  try { mkdirSync(kesefDir(), { recursive: true }); writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2)); } catch { /* non-fatal */ }
}
