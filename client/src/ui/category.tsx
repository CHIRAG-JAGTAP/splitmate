import { Bus, Clapperboard, Home, Plane, ReceiptText, ShoppingBag, UtensilsCrossed, Zap } from 'lucide-react';
import type { Category } from '../lib/types';
import { CAT_COLOR } from './charts';

const ICON = { food: UtensilsCrossed, travel: Plane, accommodation: Home, shopping: ShoppingBag, entertainment: Clapperboard, transport: Bus, utilities: Zap, other: ReceiptText };
export function CategoryIcon({ category, size = 40 }: { category: Category; size?: number }) {
  const I = ICON[category] ?? ReceiptText;
  return <span className="inline-flex shrink-0 items-center justify-center rounded-xl" style={{ width: size, height: size, background: `${CAT_COLOR[category]}22`, color: CAT_COLOR[category] }}><I style={{ width: size * 0.5, height: size * 0.5 }} /></span>;
}
