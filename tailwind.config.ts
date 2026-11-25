import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // FreshCrate palette. Leaf is the one action colour; kraft is only for
        // the confirmation card's border and citrus only for "tried" ticks.
        ink: "#17211C",
        paper: "#F7FAF7",
        muted: "#46564E",
        mist: "#DDE7E1",
        kraft: { DEFAULT: "#B98A55", dark: "#8A6334" },
        citrus: { DEFAULT: "#F5C542", dark: "#C99A00", light: "#FEF5D6" },
        brand: {
          DEFAULT: "#0B5D52", // leaf
          dark: "#08463E",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
