import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        strix: {
          bg: "rgb(var(--color-strix-bg) / <alpha-value>)",
          card: "rgb(var(--color-strix-card) / <alpha-value>)",
          elevated: "rgb(var(--color-strix-elevated) / <alpha-value>)",
          "border-subtle": "rgb(var(--color-strix-border-subtle) / <alpha-value>)",
          border: "rgb(var(--color-strix-border) / <alpha-value>)",
          text: "rgb(var(--color-strix-text) / <alpha-value>)",
          "text-secondary": "rgb(var(--color-strix-text-secondary) / <alpha-value>)",
          "text-muted": "rgb(var(--color-strix-text-muted) / <alpha-value>)",
          accent: "rgb(var(--color-strix-accent) / <alpha-value>)",
          "accent-hover": "rgb(var(--color-strix-accent-hover) / <alpha-value>)",
          "text-on-accent": "rgb(var(--color-strix-text-on-accent) / <alpha-value>)",
        },
        severity: {
          critical: "rgb(var(--color-severity-critical) / <alpha-value>)",
          high: "rgb(var(--color-severity-high) / <alpha-value>)",
          medium: "rgb(var(--color-severity-medium) / <alpha-value>)",
          low: "rgb(var(--color-severity-low) / <alpha-value>)",
          info: "rgb(var(--color-severity-info) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["Geist", "Inter", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "Fira Code", "monospace"],
      },
      borderRadius: {
        card: "12px",
        btn: "8px",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      animation: {
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
