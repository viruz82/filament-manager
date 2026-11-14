/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'rgb(var(--fm-surface) / <alpha-value>)',
          2: 'rgb(var(--fm-surface-2) / <alpha-value>)',
          3: 'rgb(var(--fm-surface-3) / <alpha-value>)',
          4: 'rgb(var(--fm-surface-4) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--fm-accent) / <alpha-value>)',
          hover: 'rgb(var(--fm-accent-hover) / <alpha-value>)',
        },
        'on-accent': 'rgb(var(--fm-on-accent) / <alpha-value>)',
        crit:  'rgb(var(--fm-crit) / <alpha-value>)',
        warn:  'rgb(var(--fm-warn) / <alpha-value>)',
        ok:    'rgb(var(--fm-ok) / <alpha-value>)',
        info:  'rgb(var(--fm-info) / <alpha-value>)',
        extra: 'rgb(var(--fm-extra) / <alpha-value>)',
      },
    },
  },
  plugins: [],
}
