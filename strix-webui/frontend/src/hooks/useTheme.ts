import { useState, useEffect, useCallback } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "strix-theme";

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? getSystemTheme() : pref;
}

function applyTheme(resolved: ResolvedTheme) {
  const html = document.documentElement;
  html.classList.remove("dark", "light");
  html.classList.add(resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#0A0A0A" : "#F5F5F5");
}

function readStored(): ThemePreference {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemePreference>(readStored);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readStored()));

  const setTheme = useCallback((next: ThemePreference) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
    const r = resolve(next);
    setResolved(r);
    applyTheme(r);
  }, []);

  // Listen for system preference changes when in "system" mode
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (readStored() === "system") {
        const r = getSystemTheme();
        setResolved(r);
        applyTheme(r);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Apply on mount (in case React hydrates after the anti-flash script)
  useEffect(() => {
    applyTheme(resolve(readStored()));
  }, []);

  return { theme, resolved, setTheme } as const;
}
