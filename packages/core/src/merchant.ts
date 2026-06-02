// Canonical names for common recurring merchants, checked first (case-insensitive, he + en).
const ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/lime/i, 'Lime'],
  [/wolt/i, 'Wolt'],
  [/spotify/i, 'Spotify'],
  [/netflix/i, 'Netflix'],
  [/paybox|פייבוקס/i, 'PayBox'],
  [/שופרסל|shufersal/i, 'שופרסל'],
  [/רמי לוי|rami\s*levy/i, 'רמי לוי'],
  [/סופר פארם|super[-\s]?pharm/i, 'סופר פארם'],
  [/\bpaz\b|תחנת פז/i, 'Paz'],
  [/סונול|sonol/i, 'Sonol'],
];

/** Reduce a raw transaction description to a stable, human merchant name (for grouping recurring spend). */
export function normalizeMerchant(description: string): string {
  const d = description.trim();
  for (const [re, name] of ALIASES) if (re.test(d)) return name;
  // Fallback: take the text before the first '*', then strip trailing phone/number/locale noise.
  let s = d.split('*')[0]!.trim();
  s = s.replace(/\s*\+?\d[\d().\-\s]*$/g, '').trim();   // trailing phone/number run
  s = s.replace(/\s+\b(US|USA|IL|TLV)\b\s*$/gi, '').trim(); // trailing locale token
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s || d;
}
