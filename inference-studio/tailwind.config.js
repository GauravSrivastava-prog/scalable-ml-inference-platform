/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#050505', // Pitch black base
        surface: '#121212',    // Slightly elevated
        primary: '#ffffff',    // Stark white text
        muted: '#a3a3a3',      // Dimmed text
        accent: '#3b82f6',     // Subtle blue for active states
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}