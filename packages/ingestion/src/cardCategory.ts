import type { CategoryCode } from '@kesef/core';

// Cal `branchCodeDesc` (and similar card categories) → our buckets. Substring match, Hebrew.
// PROVISIONAL seed — refine against real values surfaced by `npm run list`.
const CARD_MAP: ReadonlyArray<readonly [CategoryCode, readonly string[]]> = [
  ['dining',        ['מסעד', 'בתי קפה', 'בית קפה', 'קפה', 'מזון מהיר', 'פיצ']],
  ['groceries',     ['סופרמרקט', 'סופר מרקט', 'מזון', 'מכולת', 'שוק']],
  ['transport',     ['דלק', 'תחבורה', 'חני', 'מוסך', 'רכב', 'נסיעות', 'תיירות', 'טיסות', 'מלונות']],
  ['utilities',     ['חשמל', 'תקשורת', 'סלולר', 'אינטרנט', 'מים', 'גז']],
  ['health',        ['בריאות', 'פארם', 'בתי מרקחת', 'רפואה', 'קופת חולים', 'ספורט', 'כושר']],
  ['entertainment', ['בידור', 'פנאי', 'תרבות', 'קולנוע', 'סטרימינג']],
  ['shopping',      ['ביגוד', 'הלבשה', 'אופנה', 'אלקטרוניקה', 'ריהוט', 'כלבו', 'צעצועים', 'ספרים']],
  ['housing',       ['שכר דירה', 'דיור', 'ארנונה', 'ועד בית']],
  ['fees',          ['עמלות', 'ריבית', 'דמי כרטיס']],
];

/** Map a card-provided category string to our bucket, or undefined if unrecognised. */
export function mapCardCategory(raw: string | undefined): CategoryCode | undefined {
  if (!raw) return undefined;
  const hay = raw.toLowerCase();
  for (const [code, subs] of CARD_MAP) if (subs.some(s => hay.includes(s))) return code;
  return undefined;
}
