/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--color-background) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        'surface-elevated': 'rgb(var(--color-surface-elevated) / <alpha-value>)',
        'surface-sunken': 'rgb(var(--color-surface-sunken) / <alpha-value>)',
        'surface-hover': 'rgb(var(--color-surface-hover) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        'border-strong': 'rgb(var(--color-border-strong) / <alpha-value>)',
        'border-control': 'rgb(var(--color-border-control) / <alpha-value>)',
        'text-primary': 'rgb(var(--color-text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--color-text-secondary) / <alpha-value>)',
        'text-muted': 'rgb(var(--color-text-muted) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        'accent-bright': 'rgb(var(--color-accent-bright) / <alpha-value>)',
        'focus-ring': 'rgb(var(--color-focus-ring) / <alpha-value>)',

        // ── System status (5-state) ──
        ok: {
          DEFAULT: 'rgb(var(--color-status-ok) / <alpha-value>)',
          fill: 'rgb(var(--color-status-ok-fill) / <alpha-value>)',
          border: 'rgb(var(--color-status-ok-border) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--color-status-warning) / <alpha-value>)',
          fill: 'rgb(var(--color-status-warning-fill) / <alpha-value>)',
          border: 'rgb(var(--color-status-warning-border) / <alpha-value>)',
        },
        critical: {
          DEFAULT: 'rgb(var(--color-status-critical) / <alpha-value>)',
          fill: 'rgb(var(--color-status-critical-fill) / <alpha-value>)',
          border: 'rgb(var(--color-status-critical-border) / <alpha-value>)',
        },
        offline: {
          DEFAULT: 'rgb(var(--color-status-offline) / <alpha-value>)',
          fill: 'rgb(var(--color-status-offline-fill) / <alpha-value>)',
          border: 'rgb(var(--color-status-offline-border) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(var(--color-status-info) / <alpha-value>)',
          fill: 'rgb(var(--color-status-info-fill) / <alpha-value>)',
          border: 'rgb(var(--color-status-info-border) / <alpha-value>)',
        },

        // ── Risk bands (separate ramp, PRD §20.5) ──
        risk: {
          high: {
            DEFAULT: 'rgb(var(--color-risk-high) / <alpha-value>)',
            fill: 'rgb(var(--color-risk-high-fill) / <alpha-value>)',
            border: 'rgb(var(--color-risk-high-border) / <alpha-value>)',
          },
          medium: {
            DEFAULT: 'rgb(var(--color-risk-medium) / <alpha-value>)',
            fill: 'rgb(var(--color-risk-medium-fill) / <alpha-value>)',
            border: 'rgb(var(--color-risk-medium-border) / <alpha-value>)',
          },
          low: {
            DEFAULT: 'rgb(var(--color-risk-low) / <alpha-value>)',
            fill: 'rgb(var(--color-risk-low-fill) / <alpha-value>)',
            border: 'rgb(var(--color-risk-low-border) / <alpha-value>)',
          },
        },
      },
      fontFamily: {
        sans: ['"Inter Tight Variable"', '"Inter Tight"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { none: '0', sm: '3px', DEFAULT: '6px', md: '8px', lg: '10px', xl: '8px', '2xl': '12px' },
      boxShadow: {
        panel: 'var(--shadow-panel)',
        float: 'var(--shadow-float)',
        modal: 'var(--shadow-modal)',
        'glow-accent': 'none',
      },
      transitionTimingFunction: { out: 'var(--ease-out)', 'in-out': 'var(--ease-in-out)' },
      transitionDuration: { tap: '90ms', hover: '140ms', move: '150ms', enter: '150ms' },
      keyframes: {
        'rise-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(100%)' } },
        'live-ping': { '0%': { transform: 'scale(1)', opacity: '0.6' }, '70%,100%': { transform: 'scale(2.4)', opacity: '0' } },
      },
      animation: {
        'rise-in': 'rise-in var(--dur-enter) var(--ease-out) both',
        'fade-in': 'fade-in var(--dur-enter) var(--ease-out) both',
        'scale-in': 'scale-in var(--dur-move) var(--ease-out) both',
        shimmer: 'shimmer 1.6s var(--ease-in-out) infinite',
        'live-ping': 'live-ping 2s var(--ease-out) infinite',
      },
    },
  },
  plugins: [],
};
