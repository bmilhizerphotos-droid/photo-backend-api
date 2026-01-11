/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}"
  ],
  safelist: [
    'columns-1',
    'columns-2',
    'columns-3',
    'columns-4',
    'columns-5',
    'sm:columns-2',
    'md:columns-3',
    'lg:columns-4',
    'xl:columns-5',
    'break-inside-avoid'
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};