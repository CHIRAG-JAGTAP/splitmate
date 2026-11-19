import type { Category } from '../lib/types';

/** One colour per category, reused across every chart so a category is always recognisable. Checked for distinguishability in light and dark. */
export const CAT_COLOR: Record<Category, string> = {
  food: '#E2711D', travel: '#2A9D8F', accommodation: '#6C5CE7', shopping: '#D6336C', entertainment: '#F2A900', transport: '#3B82C4', utilities: '#7A8B3A', other: '#8A9AA0',
};
export const CAT_LABEL: Record<Category, string> = { food: 'Food', travel: 'Travel', accommodation: 'Accommodation', shopping: 'Shopping', entertainment: 'Entertainment', transport: 'Transport', utilities: 'Utilities', other: 'Other' };
export const axis = { stroke: 'rgb(var(--muted))', fontSize: 12, tickLine: false, axisLine: false } as const;
