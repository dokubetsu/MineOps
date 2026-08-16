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
          deep: '#020203',
          base: '#050506',
          elevated: '#0a0a0c',
        },
        surface: {
          DEFAULT: 'rgba(255, 255, 255, 0.05)',
          hover: 'rgba(255, 255, 255, 0.08)',
        },
        foreground: {
          DEFAULT: '#EDEDEF',
          muted: '#8A8F98',
          subtle: 'rgba(255, 255, 255, 0.60)',
        },
        accent: {
          DEFAULT: '#5E6AD2',
          bright: '#6872D9',
          glow: 'rgba(94, 106, 210, 0.3)',
        },
        border: {
          default: 'rgba(255, 255, 255, 0.06)',
          hover: 'rgba(255, 255, 255, 0.10)',
          accent: 'rgba(94, 106, 210, 0.30)',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'sans-serif'],
        display: ['var(--font-space-grotesk)', 'Space Grotesk', 'sans-serif'],
      },
      boxShadow: {
        'card-ambient': '0 0 0 1px rgba(255, 255, 255, 0.06), 0 2px 20px rgba(0, 0, 0, 0.4), 0 0 40px rgba(0, 0, 0, 0.2)',
        'card-hover': '0 0 0 1px rgba(255, 255, 255, 0.1), 0 8px 40px rgba(0, 0, 0, 0.5), 0 0 80px rgba(94, 106, 210, 0.1)',
        'accent-cta': '0 0 0 1px rgba(94, 106, 210, 0.5), 0 4px 12px rgba(94, 106, 210, 0.3), inset 0 1px 0 0 rgba(255, 255, 255, 0.2)',
        'inner-highlight': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
        'glow-sm': '0 0 20px rgba(94, 106, 210, 0.2)',
        'glow-lg': '0 0 50px rgba(94, 106, 210, 0.25)',
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
