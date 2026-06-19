import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: '#050505',
        panel: '#0c0c0c',
        graphite: '#161616',
        muted: '#737373',
        emerald: {
          DEFAULT: '#10b981',
          dim: '#059669',
          glow: '#34d399',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        display: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
      maxWidth: {
        boutique: '1400px',
      },
      animation: {
        shimmer: 'shimmer 1.8s ease-in-out infinite',
      },
      keyframes: {
        shimmer: {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '0.65' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
