import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0f766e", // teal-700, FreshCrate accent
          dark: "#115e59",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
