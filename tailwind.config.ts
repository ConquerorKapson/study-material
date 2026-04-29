import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0b",
        panel: "#131316",
        panel2: "#1b1b20",
        border: "#2a2a32",
        muted: "#8a8a96",
        text: "#e8e8ee",
        accent: "#7c5cff",
        accent2: "#22d3ee",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "Inter", "Segoe UI", "Arial"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [typography],
};
export default config;
