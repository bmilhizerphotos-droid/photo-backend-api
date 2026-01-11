/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}"
  ],
  safelist: [
    'columns-2',
    'columns-3',
    'columns-4',
    'columns-5',
    'columns-6',
    'sm:columns-3',
    'md:columns-4',
    'lg:columns-5',
    'xl:columns-6',
    'break-inside-avoid'
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};