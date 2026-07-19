// Best-effort reader for Hilan payslip PDFs (Check Point uses Hilan).
//
// Hilan PDFs embed Hebrew in a legacy visual encoding, so pdfjs extracts the labels as stable-but-
// garbled Latin bytes — while the NUMBERS come through clean. We match the (consistent) garbled label
// bytes to pull the core amounts, and the UI always shows the result in an editable confirm-form, so a
// missed field just means the user fills that one box. Nothing is auto-saved.
//
// ponytail: label-byte matching is Hilan-template-specific; if Check Point changes the payslip layout
// this degrades to "fill it manually", which the confirm-form already handles. Upgrade path: add more
// label variants here as new samples surface.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ParsedPayslip {
  month?: string; gross?: number; net?: number; tax?: number;
  pensionEmp?: number; kerenEmp?: number; espp?: number;
  employerPension?: number; employerSeverance?: number; employerKeren?: number;
}

// Garbled-Hebrew label bytes as pdfjs emits them for the Hilan template.
const LBL = {
  gross: 'íéîåìùúä ìë-êñ',   // סך כל התשלומים  (total payments)
  net: 'íåìùúì åèð',          // נטו לתשלום       (net to bank)
  tax: 'íéñî-äáåç ééåëéð',    // ניכויי חובה-מסים (tax + national ins. + health)
  gemel: 'ìîâ úåôå÷',          // קופות גמל        (employee pension+study, combined)
  keren: 'úåîìúùä ïø÷',        // קרן השתלמות
  pension: 'äáö÷ úéùéà úô÷î',  // מקפת אישית קצבה
  severance: 'íééåöéô úéùéà úô÷î', // מקפת אישית פיצויים
};

const num = (s: string | undefined): number => (s ? Number(String(s).replace(/,/g, '')) : 0);

/** Number immediately preceding a (garbled) label — the RTL layout puts the amount just before it. */
function before(text: string, label: string, w = 24): number {
  const i = text.indexOf(label);
  if (i < 0) return 0;
  const m = text.slice(Math.max(0, i - w), i).match(/([\d,]+(?:\.\d{1,2})?)\s*$/);
  return m ? num(m[1]) : 0;
}

/** A gemel-detail row reads (RTL→LTR): emp, empPct, employer, employerPct, base, <label>. Counting the
 *  decimal amounts back from the label: base=-1, employer=-3, emp=-5. */
function twoAmts(text: string, label: string): { emp: number; er: number } | null {
  const i = text.indexOf(label);
  if (i < 0) return null;
  const win = text.slice(Math.max(0, i - 80), i);
  const nums = [...win.matchAll(/([\d,]+\.\d{2})/g)].map(m => num(m[1]));
  if (nums.length < 5) return null;
  return { emp: nums[nums.length - 5], er: nums[nums.length - 3] };
}

export function parsePayslip(text: string): ParsedPayslip {
  const f: ParsedPayslip = {};
  const gross = before(text, LBL.gross), net = before(text, LBL.net), tax = before(text, LBL.tax);
  if (gross) f.gross = gross;
  if (net) f.net = net;
  if (tax) f.tax = tax;

  const gemel = before(text, LBL.gemel);
  const keren = twoAmts(text, LBL.keren);
  if (keren) { f.kerenEmp = keren.emp; if (keren.er) f.employerKeren = keren.er; }
  // employee pension: robust as (total employee gemel − study fund); the pension row has a sub-label
  // wedged between its columns, so a direct positional match is unreliable.
  if (gemel && f.kerenEmp) f.pensionEmp = Math.round((gemel - f.kerenEmp) * 100) / 100;
  else if (gemel) f.pensionEmp = gemel;
  const pens = twoAmts(text, LBL.pension);
  if (pens && pens.er) f.employerPension = pens.er;
  const sevI = text.indexOf(LBL.severance);
  if (sevI >= 0) {
    const m = [...text.slice(Math.max(0, sevI - 60), sevI).matchAll(/([\d,]+\.\d{2})/g)].map(x => num(x[1]));
    if (m.length) f.employerSeverance = m[0];
  }
  const espp = text.match(/ESPP[^\d]{0,6}([\d,]+\.\d{2})|([\d,]+\.\d{2})[^\d]{0,6}ESPP/);
  if (espp) f.espp = num(espp[1] || espp[2]);

  const dm = text.match(/\b(\d{2})\/(\d{2})\/(\d{2})\b/); // period date DD/MM/YY → YYYY-MM
  if (dm) f.month = '20' + dm[3] + '-' + dm[2];

  for (const k of Object.keys(f) as (keyof ParsedPayslip)[]) if (!f[k]) delete f[k];
  return f;
}

/** Extract the raw text of a PDF (all pages) via pdfjs. */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const doc = await getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out += ' ' + tc.items.map(it => ('str' in it ? it.str : '')).join(' ');
  }
  await doc.destroy();
  return out;
}

/** Read a payslip PDF buffer → best-effort fields. */
export async function parsePayslipPdf(data: Uint8Array): Promise<ParsedPayslip> {
  return parsePayslip(await extractPdfText(data));
}
