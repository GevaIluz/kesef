import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { kesefDir } from './paths.js';

/** Where a portal's total lives (url + taught selector), learned once per portal (ibi, mvs, …). */
export interface PortalConfig { url?: string; selector?: string }

const cfgPath = () => join(kesefDir(), 'portals.json');
const legacyIbiPath = () => join(kesefDir(), 'ibi.json'); // pre-portals.json installs kept IBI here

function readJson(path: string): Record<string, unknown> {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return (j && typeof j === 'object') ? j as Record<string, unknown> : {};
  } catch { return {}; }
}

export function loadPortalConfig(key: string): PortalConfig {
  const cfg = readJson(cfgPath())[key];
  if (cfg && typeof cfg === 'object') return cfg as PortalConfig;
  if (key === 'ibi') return readJson(legacyIbiPath()) as PortalConfig;
  return {};
}

export function savePortalConfig(key: string, cfg: PortalConfig): void {
  try {
    mkdirSync(kesefDir(), { recursive: true });
    const all = readJson(cfgPath());
    all[key] = cfg;
    writeFileSync(cfgPath(), JSON.stringify(all, null, 2));
  } catch { /* non-fatal: next sync just re-teaches */ }
}
