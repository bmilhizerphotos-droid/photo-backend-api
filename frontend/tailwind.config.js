/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}",
  ],
  safelist: [
    "columns-[10rem]",
    "columns-[12rem]",
    "columns-[14rem]",
    "columns-[16rem]",
    "columns-[18rem]",
    "sm:columns-[12rem]",
    "md:columns-[14rem]",
    "lg:columns-[16rem]",
    "xl:columns-[18rem]",
    "break-inside-avoid",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
