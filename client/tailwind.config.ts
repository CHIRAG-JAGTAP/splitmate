import type { Config } from 'tailwindcss';

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), raised: v('raised'), line: v('line'), ink: v('ink'), muted: v('muted'),
        brand: { DEFAULT: v('brand'), soft: v('brand-soft'), ink: v('brand-ink') },
        gold: { DEFAULT: v('gold'), soft: v('gold-soft') },
        pos: { DEFAULT: v('pos'), soft: v('pos-soft') },
        neg: { DEFAULT: v('neg'), soft: v('neg-soft') },
      },
      fontFamily: { display: ['"Bricolage Grotesque"', 'Figtree', 'system-ui', 'sans-serif'], sans: ['Figtree', 'system-ui', 'sans-serif'] },
      borderRadius: { card: '14px', ctl: '10px' },
      boxShadow: { card: '0 1px 0 rgb(var(--line) / .7), 0 8px 24px -16px rgb(var(--shadow) / .35)', pop: '0 18px 48px -12px rgb(var(--shadow) / .45)' },
      keyframes: {
        pop: { from: { opacity: '0', transform: 'translateY(6px) scale(.98)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        tape: { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
      },
      animation: { pop: 'pop .18s ease-out', tape: 'tape .7s cubic-bezier(.2,.8,.2,1) both' },
    },
  },
  plugins: [],
} satisfies Config;
