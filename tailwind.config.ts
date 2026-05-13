import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#f5f0e8",
        panel: "#ece7dd",
        panel2: "#e3ddd2",
        border: "#d4cfc6",
        muted: "#6b6560",
        text: "#0f0e0c",
        accent: "#c8392b",
        accent2: "#b8860b",
        ink: "#0f0e0c",
        paper: "#f5f0e8",
        green: "#2d6a4f",
        blue: "#1a4a6b",
        "code-bg": "#1a1917",
        "code-text": "#e8e3d8",
      },
      fontFamily: {
        serif: ["'Playfair Display'", "Georgia", "serif"],
        sans: ["'DM Sans'", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "Consolas", "monospace"],
      },
    },
  },
  plugins: [typography],
};
export default config;
