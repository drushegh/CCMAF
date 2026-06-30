/**
 * featureFlags.ts — simple build-time feature toggles for the Console.
 *
 * `headroom` is PARKED (TASK-029). The Headroom analytics surface (parser,
 * `/api/headroom`, the `/headroom` page) is fully built + tested, but hidden
 * from the UI for now because Headroom can't be exercised on this platform yet
 * (its native engine isn't shipped for Windows — see TASKS.md / GOTCHAS).
 * Nothing is deleted. To bring it back: set `headroom: true` — the nav entry +
 * route return and the page works against the same endpoint.
 */
export const FEATURES = {
  headroom: true,
} as const;
