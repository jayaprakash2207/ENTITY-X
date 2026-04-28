/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './renderer/index.html',
    './renderer/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#060610',
        surface: '#0d0d1f',
        panel: '#111120',
        card: '#161626',
        accent: '#8b5cf6',
        'accent-light': '#a78bfa',
        danger: '#f87171',
        warning: '#fbbf24',
        success: '#34d399',
        muted: '#64748b',
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'card': '10px',
      },
    },
  },
  plugins: [],
}
