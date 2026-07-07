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
  "mono",
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

/* ── Cross-instance sync ──
   Several useAccent() consumers coexist (the header AccentPicker AND the ⌘K
   command palette). The visual theme is always correct — it's a single
   <html data-accent> attribute — but before this store a change from ONE
   instance (e.g. the palette setting an accent) left the OTHER instance's
   React state stale, so its checkmark lagged. A module-level store keeps every
   instance in lock-step, and a `storage` listener extends that to other tabs. */

let currentAccent: Accent = readStoredAccent();
const listeners = new Set<(a: Accent) => void>();

/** Reflect the accent onto <html> (purple = the default :root values). */
function applyAccent(a: Accent): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (a === "purple") root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", a);
}

/** Persist + apply + broadcast to every live useAccent() instance. */
function commitAccent(a: Accent): void {
  currentAccent = a;
  applyAccent(a);
  try {
    localStorage.setItem(STORAGE_KEY, a);
  } catch {
    /* ignore persistence failure */
  }
  for (const l of listeners) l(a);
}

// Keep the DOM honest even without the pre-paint inline script (tests/SSR
// hydration), then mirror cross-tab writes into this tab's store.
if (typeof window !== "undefined") {
  applyAccent(currentAccent);
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next = isAccent(e.newValue) ? e.newValue : "purple";
    if (next === currentAccent) return;
    currentAccent = next;
    applyAccent(next);
    for (const l of listeners) l(next);
  });
}

export function useAccent(): {
  accent: Accent;
  setAccent: (a: Accent) => void;
} {
  const [accent, setAccentState] = useState<Accent>(currentAccent);

  useEffect(() => {
    // Catch any change that landed between module init and this subscribe,
    // then track every future change from any instance/tab.
    setAccentState(currentAccent);
    const listener = (a: Accent): void => setAccentState(a);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const setAccent = useCallback((a: Accent) => commitAccent(a), []);

  return { accent, setAccent };
}
