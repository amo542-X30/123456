/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        vault: {
          black: '#050608',
          900: '#0a0c10',
          800: '#0f1217',
          700: '#161a21',
          600: '#1d222b',
          500: '#252b36',
          400: '#2e3542',
          300: '#3a4250',
        },
        cyber: {
          green: '#00ff9c',
          'green-dim': '#00cc7d',
          'green-glow': 'rgba(0, 255, 156, 0.15)',
          blue: '#0af',
          'blue-dim': '#0088dd',
          red: '#ff3b5c',
          amber: '#ffb340',
          'gray-text': '#8a95a8',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan-line': 'scanLine 4s linear infinite',
        'flicker': 'flicker 3s linear infinite',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(20px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        scanLine: { '0%': { transform: 'translateY(-100%)' }, '100%': { transform: 'translateY(100vh)' } },
        flicker: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.85' } },
        glowPulse: { '0%,100%': { boxShadow: '0 0 5px rgba(0,255,156,0.1)' }, '50%': { boxShadow: '0 0 20px rgba(0,255,156,0.3)' } },
      },
    },
  },
  plugins: [],
};
