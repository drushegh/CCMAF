/**
 * useTheme — dark/light theme state for the cockpit.
 *
 * The theme is a single attribute on <html data-theme="…">; all colours are
 * CSS custom properties (see styles/theme.css), so flipping the attribute
 * re-themes the whole app with no per-component work. Dark is the default
 * (no attribute = the base :root values); "light" opts in to the override block.
 *
 * The choice persists in localStorage and is applied pre-paint by a tiny inline
 * script in index.html, so there is no flash of the wrong theme on reload. This
 * hook keeps React state in sync and writes the attribute + storage on change.
 */
import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "console-theme";

/** Read the persisted theme; default to dark (the cockpit's native look). */
export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage unavailable (private mode / SSR) — fall through */
  }
  return "dark";
}

export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void } {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme"); // dark = the default :root values
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore persistence failure */
    }
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    []
  );

  return { theme, toggle, setTheme };
}
