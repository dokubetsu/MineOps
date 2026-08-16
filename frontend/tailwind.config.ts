import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: {
          deep: '#03080A',
          base: '#060F12',
          elevated: '#0E1B1E',
        },
        surface: {
          DEFAULT: 'rgba(255, 255, 255, 0.05)',
          hover: 'rgba(255, 255, 255, 0.08)',
        },
        foreground: {
          DEFAULT: '#EDEDEF',
          muted: '#8A999E',
          subtle: 'rgba(255, 255, 255, 0.60)',
        },
        accent: {
          DEFAULT: '#0D9488',
          bright: '#14B8A6',
          dark: '#0F766E',
          glow: 'rgba(20, 184, 166, 0.35)',
        },
        gem: {
          DEFAULT: '#D97706',
          bright: '#F59E0B',
          glow: 'rgba(217, 119, 6, 0.35)',
        },
        telematics: {
          DEFAULT: '#0EA5E9',
          bright: '#38BDF8',
          glow: 'rgba(14, 165, 233, 0.30)',
        },
        border: {
          default: 'rgba(255, 255, 255, 0.06)',
          hover: 'rgba(255, 255, 255, 0.12)',
          accent: 'rgba(20, 184, 166, 0.35)',
          gem: 'rgba(217, 119, 6, 0.35)',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'sans-serif'],
        display: ['var(--font-space-grotesk)', 'Space Grotesk', 'sans-serif'],
      },
      boxShadow: {
        'card-ambient': '0 0 0 1px rgba(255, 255, 255, 0.06), 0 2px 20px rgba(0, 0, 0, 0.5), 0 0 40px rgba(0, 0, 0, 0.3)',
        'card-hover': '0 0 0 1px rgba(20, 184, 166, 0.25), 0 8px 40px rgba(0, 0, 0, 0.6), 0 0 80px rgba(20, 184, 166, 0.12)',
        'accent-cta': '0 0 0 1px rgba(20, 184, 166, 0.5), 0 4px 14px rgba(20, 184, 166, 0.35), inset 0 1px 0 0 rgba(255, 255, 255, 0.2)',
        'inner-highlight': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
        'glow-sm': '0 0 20px rgba(20, 184, 166, 0.25)',
        'glow-lg': '0 0 50px rgba(20, 184, 166, 0.35)',
      },
      transitionTimingFunction: {
        'expo-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      animation: {
        'float-slow': 'float 9s ease-in-out infinite',
        'float-delayed': 'float 11s ease-in-out 3s infinite',
        'float-reverse': 'float-reverse 10s ease-in-out 1.5s infinite',
        'pulse-glow': 'pulse-glow 5s ease-in-out infinite',
        'shimmer': 'shimmer 2.5s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px) rotate(0deg)' },
          '50%': { transform: 'translateY(-22px) rotate(1.5deg)' },
        },
        'float-reverse': {
          '0%, 100%': { transform: 'translateY(0px) rotate(0deg)' },
          '50%': { transform: 'translateY(18px) rotate(-1.5deg)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.2', transform: 'scale(1)' },
          '50%': { opacity: '0.32', transform: 'scale(1.05)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
}

export default config
