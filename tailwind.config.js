/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        slateqc: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
          950: '#08111F',
        },
        accent: {
          blue: '#3B82F6',
          cyan: '#06B6D4',
          orange: '#F97316',
          red: '#EF4444',
          amber: '#F59E0B',
          emerald: '#10B981',
          violet: '#8B5CF6',
          pink: '#EC4899',
          indigo: '#6366F1',
          lime: '#EAB308',
        }
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        body: ['system-ui', 'sans-serif'],
      },
      keyframes: {
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(239,68,68,0.5)' },
          '70%': { boxShadow: '0 0 0 10px rgba(239,68,68,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(239,68,68,0)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s infinite',
        'fade-in': 'fade-in 0.3s ease-out both',
        'slide-in-right': 'slide-in-right 0.25s ease-out both',
      },
      boxShadow: {
        'soft': '0 2px 12px -2px rgba(15,23,42,0.08), 0 1px 4px -1px rgba(15,23,42,0.06)',
        'card': '0 4px 20px -4px rgba(15,23,42,0.12), 0 2px 8px -2px rgba(15,23,42,0.08)',
      }
    },
  },
  plugins: [],
};
