import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        strix: {
          bg: "#0A0A0A",
          card: "#141414",
          elevated: "#1F1F1F",
          "border-subtle": "#2A2A2A",
          border: "#3A3A3A",
          text: "#FFFFFF",
          "text-secondary": "#A0A0A0",
          "text-muted": "#6B6B6B",
          accent: "#22C55E",
          "accent-hover": "#16A34A",
        },
        severity: {
          critical: "#FF0000",
          high: "#FF6B00",
          medium: "#FFB800",
          low: "#00A8FF",
          info: "#6B6B6B",
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
