import type { CategoryCode } from '@kesef/core';
import { mapCardCategory } from './cardCategory.js';

// Ordered: earlier rules win. Each rule = [category, [substrings to match, lower-cased]].
// Seeded with common Israeli merchants (Hebrew + English). Extend freely.
const RULES: ReadonlyArray<readonly [CategoryCode, readonly string[]]> = [
  ['income',        ['משכורת', 'salary', 'קצבה']],
  ['transfer',      ['העברה', 'bit', 'ביט', 'paybox', 'פייבוקס', 'transfer']],
  ['housing',       ['שכירות', 'משכנתא', 'mortgage', 'rent', 'ארנונה', 'ועד בית']],
  ['utilities',     ['חברת חשמל', 'חשמל', 'מים', 'בזק', 'bezeq', 'hot', 'הוט', 'פרטנר', 'partner', 'סלקום', 'cellcom', 'yes', 'גולן', 'אינטרנט']],
  ['groceries',     ['שופרסל', 'shufersal', 'רמי לוי', 'rami levy', 'ויקטורי', 'יינות ביתן', 'אושר עד', 'טיב טעם', 'tiv taam', 'מגה', 'יוחננוף', 'סופרמרקט']],
  ['dining',        ['קפה', 'cafe', 'מסעד', 'restaurant', 'וולט', 'wolt', 'מקדונלד', 'mcdonald', 'burger', 'בורגר', 'פיצה', 'pizza', 'ארומה', 'aroma', 'גולדה', 'רולדין']],
  ['transport',     ['פז', 'paz', 'סונול', 'sonol', 'דלק', 'delek', 'רכבת', 'רב קו', 'רב-קו', 'gett', 'יאנגו', 'yango', 'אגד', 'חניון', 'parking', 'pango', 'סלופארק', 'celopark']],
  ['health',        ['סופר פארם', 'super-pharm', 'superpharm', 'מכבי', 'כללית', 'מאוחדת', 'לאומית', 'בית מרקחת', 'pharm', 'מרפאה', 'clinic', 'רופא']],
  ['entertainment', ['נטפליקס', 'netflix', 'spotify', 'ספוטיפיי', 'סינמה', 'cinema', 'יס פלאנט', 'דיסני', 'disney', 'youtube', 'סטימצקי']],
  ['shopping',      ['זארה', 'zara', 'fox', 'קסטרו', 'castro', 'terminalx', 'טרמינל', 'ace', 'איקאה', 'ikea', 'amazon', 'אמזון', 'aliexpress', 'עלי אקספרס']],
  ['fees',          ['עמלה', 'דמי ניהול', 'ריבית', 'fee', 'commission']],
  ['investment',    ['השקעה', 'ניירות ערך', 'ני"ע', 'ibi', 'בית השקעות']],
  ['savings',       ['חיסכון', 'פיקדון', 'פקדון']],
];

/** Map a transaction description to a category. User overrides (substring -> category) win. */
export function categorize(description: string, overrides?: Record<string, CategoryCode>): CategoryCode {
  const hay = description.toLowerCase();
  if (overrides) {
    for (const [sub, cat] of Object.entries(overrides)) {
      if (sub && hay.includes(sub.toLowerCase())) return cat;
    }
  }
  for (const [cat, subs] of RULES) {
    if (subs.some(s => hay.includes(s))) return cat;
  }
  return 'other';
}

/** Decide a transaction's category: user override → card-provided category → description rules → other. */
export function assignCategory(
  t: { description: string; rawCategory?: string | undefined },
  overrides?: Record<string, CategoryCode>,
): CategoryCode {
  if (overrides) {
    const hay = t.description.toLowerCase();
    for (const [sub, cat] of Object.entries(overrides)) if (sub && hay.includes(sub.toLowerCase())) return cat;
  }
  const fromCard = mapCardCategory(t.rawCategory);
  if (fromCard) return fromCard;
  return categorize(t.description, overrides);
}
