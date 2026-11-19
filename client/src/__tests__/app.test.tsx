import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatINR, rupeesToPaise } from '../lib/money';
import { Badge, EmptyState } from '../ui';

describe('money formatting', () => {
  it('formats paise as INR without float errors', () => {
    expect(formatINR(123456)).toContain('1,234.56');
    expect(formatINR(0)).toContain('0');
  });
  it('parses rupee input to integer paise', () => {
    expect(rupeesToPaise('19.99')).toBe(1999);
    expect(rupeesToPaise('0.1')).toBe(10);
    expect(rupeesToPaise('abc')).toBeNull();
  });
});
describe('design system', () => {
  it('renders an empty state with title and body', () => {
    render(<EmptyState icon={<span>i</span>} title="Nothing here" body="Add something" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Add something')).toBeInTheDocument();
  });
  it('renders a badge', () => { render(<Badge tone="pos">paid</Badge>); expect(screen.getByText('paid')).toBeInTheDocument(); });
});
