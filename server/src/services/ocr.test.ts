import { describe, expect, it } from 'vitest';
import { parseDate, parseMerchant, parseReceipt, parseTotal } from './ocr.js';

const sample = `SHARMA SWEETS & CAFE
12, MG Road, Pune
GSTIN: 27ABCDE1234F1Z5
Bill No: 004512   Date: 14/03/2025
Masala Dosa        2   180.00
Filter Coffee      2    90.00
Subtotal                270.00
CGST 2.5%                6.75
SGST 2.5%                6.75
Grand Total             ₹283.50
Cash tendered           300.00
Thank you`;

describe('receipt parser', () => {
  it('finds merchant, date, total', () => {
    const r = parseReceipt(sample);
    expect(r.merchant).toBe('SHARMA SWEETS & CAFE');
    expect(r.date).toBe('2025-03-14');
    expect(r.totalPaise).toBe(28350);
    expect(r.confidence).toBe('high');
  });
  it('parses assorted date formats', () => {
    expect(parseDate('Date 2025-01-09')).toBe('2025-01-09');
    expect(parseDate('09-Jan-2025')).toBe('2025-01-09');
    expect(parseDate('Jan 9, 2025')).toBe('2025-01-09');
    expect(parseDate('31/02/2025')).toBeNull();
    expect(parseDate('nothing')).toBeNull();
  });
  it('total falls back to the largest amount; ignores long digit runs', () => {
    expect(parseTotal('Tea 20.00\nSamosa 35.50\nPhone 9876543210')).toBe(3550);
    expect(parseTotal('Total\n1,250.00')).toBe(125000);
    expect(parseTotal('hello')).toBeNull();
  });
  it('merchant skips boilerplate lines', () => {
    expect(parseMerchant('TAX INVOICE\n\nCafe Mocha\nDate 1/1/2025')).toBe('Cafe Mocha');
  });
});
