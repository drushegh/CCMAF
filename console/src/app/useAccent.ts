/**
 * useAccent — brand-accent colour state for the cockpit.
 *
 * Mirrors useTheme: the accent is a single attribute on <html data-accent="…">;
 * all accent colours are CSS custom properties (see styles/theme.css "ACCENT
 * VARIANTS"), so flipping the attribute re-themes every accent-driven surface
 * (nav pill, buttons, focus ring, glows, aurora, logo gradient) with no
 * per-component work. Purple (Nocturne Violet) is the default — no attribute.
 *
 * The choice persists in localStorage and is applied pre-paint by the inline
 * script in index.html, so there is no flash of the default accent on reload.
 * Status colours (ok/error/blocked/info) are separate tokens; when an accent
 * lands on one of them (green≈ok, red≈error, yellow≈blocked, blue≈info) that
 * semantic hue is nudged away per-accent in theme.css so statuses never
 * impersonate the brand colour.
 */
import { useCallback, useEffect, useState } from "react";

export const ACCENTS = [
  "purple",
  "blue",
  "red",
  "green",
  "yellow",
  "orange",
] as const;

export type Accent = (typeof ACCENTS)[number];

const STORAGE_KEY = "console-accent";

function isAccent(v: unknown): v is Accent {
  return typeof v === "string" && (ACCENTS as readonly string[]).includes(v);
}

/** Read the persisted accent; default to purple (the console's native violet). */
export function readStoredAccent(): Accent {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isAccent(v)) return v;
  } catch {
    /* storage unavailable (private mode / SSR) — fall through */
  }
  return "purple";
}

export function useAccent(): {
  accent: Accent;
  setAccent: (a: Accent) => void;
} {
  const [accent, setAccentState] = useState<Accent>(readStoredAccent);

  useEffect(() => {
    const root = document.documentElement;
    if (accent === "purple")
      root.removeAttribute("data-accent"); // purple = the default :root values
    else root.setAttribute("data-accent", accent);
    try {
      localStorage.setItem(STORAGE_KEY, accent);
    } catch {
      /* ignore persistence failure */
    }
  }, [accent]);

  const setAccent = useCallback((a: Accent) => setAccentState(a), []);

  return { accent, setAccent };
}
