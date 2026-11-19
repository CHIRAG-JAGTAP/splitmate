import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http.js';

const run = promisify(execFile);

export interface OcrResult { merchant: string | null; date: string | null; totalPaise: number | null; rawText: string; confidence: 'high' | 'medium' | 'low' }

/** Runs the LOCAL tesseract binary. No network, no paid API. */
export async function extractText(file: string): Promise<string> {
  try {
    const { stdout } = await run(env.TESSERACT_PATH, [file, 'stdout', '-l', 'eng', '--psm', '6'], { timeout: 45_000, maxBuffer: 5 * 1024 * 1024 });
    return stdout;
  } catch (e: any) {
    if (e.code === 'ENOENT') throw new HttpError(503, 'Tesseract OCR is not installed on the server. Install it and set TESSERACT_PATH in .env (see README).', 'OCR_UNAVAILABLE');
    throw new HttpError(422, 'Could not read text from this image. Try a clearer photo.', 'OCR_FAILED');
  }
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y: number, m: number, d: number) => {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? dt.toISOString().slice(0, 10) : null;
};

export function parseDate(text: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) { const r = iso(+m[1], +m[2], +m[3]); if (r) return r; }
  if ((m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) { const r = iso(+m[3], +m[2], +m[1]); if (r) return r; } // Indian receipts are DD/MM/YYYY
  if ((m = text.match(/\b(\d{1,2})[\s-]+([A-Za-z]{3})[a-z]*[\s,.-]+(\d{2,4})\b/))) { const mo = MONTHS[m[2].toLowerCase()]; if (mo) { const r = iso(+m[3], mo, +m[1]); if (r) return r; } }
  if ((m = text.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/))) { const mo = MONTHS[m[1].toLowerCase()]; if (mo) { const r = iso(+m[3], mo, +m[2]); if (r) return r; } }
  return null;
}

const AMOUNT = /(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;
function amountsIn(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(AMOUNT)) {
    const raw = m[1].replace(/,/g, '');
    if (!/\./.test(raw) && !/[₹]|rs|inr/i.test(m[0]) && raw.length > 6) continue; // long digit runs are phone/GST/bill numbers
    const v = Math.round(parseFloat(raw) * 100);
    if (Number.isFinite(v) && v > 0 && v < 100_000_000_00) out.push(v);
  }
  return out;
}

export function parseTotal(text: string): number | null {
  const lines = text.split(/\r?\n/);
  const strong = /(grand\s*total|total\s*(?:amount|payable|due)|amount\s*(?:payable|due)|net\s*(?:amount|payable)|bill\s*amount|\btotal\b)/i;
  const weak = /(sub\s*total|subtotal|tax|gst|cgst|sgst|vat|discount|change|cash|tendered|round)/i;
  const cands: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (strong.test(lines[i]) && !weak.test(lines[i].replace(/grand\s*total/i, 'GT'))) {
      const a = amountsIn(lines[i]);
      cands.push(...(a.length ? a : amountsIn(lines[i + 1] ?? '')));
    }
  }
  if (cands.length) return Math.max(...cands);
  const all = lines.filter((l) => !/(phone|ph\b|tel|gstin|invoice|bill\s*no|order)/i.test(l)).flatMap(amountsIn);
  return all.length ? Math.max(...all) : null;
}

export function parseMerchant(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
  for (const l of lines) {
    const letters = (l.match(/[A-Za-z]/g) ?? []).length;
    if (letters < 3 || letters / l.length < 0.5) continue;
    if (/(invoice|receipt|bill|tax|gstin|cash memo|welcome|date|time|tel|phone|www\.|@)/i.test(l)) continue;
    return l.replace(/[^\w &'.,-]/g, '').trim().slice(0, 60) || null;
  }
  return null;
}

export function parseReceipt(text: string): OcrResult {
  const merchant = parseMerchant(text), date = parseDate(text), totalPaise = parseTotal(text);
  const found = [merchant, date, totalPaise].filter((x) => x !== null).length;
  return { merchant, date, totalPaise, rawText: text.trim(), confidence: found === 3 ? 'high' : found === 2 ? 'medium' : 'low' };
}

export async function scanReceipt(file: string) { return parseReceipt(await extractText(file)); }
