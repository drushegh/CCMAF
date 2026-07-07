/**
 * fuzzy.ts — dependency-free subsequence scorer for the ⌘K command palette
 * (CONSOLE-V2-DESIGN.md §2.10, TASK-103).
 *
 * `fuzzyScore(query, text)` → { score, positions } or null when `query` is not
 * a case-insensitive subsequence of `text`. Exact substrings outrank scattered
 * subsequences; word-start hits (after one of ` -_./:([`) and prefix matches
 * (the "task-9" → "TASK-092" ID case) earn bonuses; gaps and long targets pay
 * a small penalty. `positions` index into the original `text` so the palette
 * can highlight the matched characters.
 */

export interface FuzzyMatch {
  score: number;
  /** Indexes into the original `text` of each matched character. */
  positions: number[];
}

const WORD_BREAKS = " -_./:([";

function isWordStart(text: string, i: number): boolean {
  return i === 0 || WORD_BREAKS.includes(text[i - 1]);
}

/** Shorter targets rank slightly higher at equal match quality. */
function lengthBonus(t: string): number {
  return Math.max(0, 10 - Math.floor(t.length / 12));
}

export function fuzzyScore(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { score: 0, positions: [] }; // empty matches all
  const t = text.toLowerCase();
  if (q.length > t.length) return null;

  // Exact substring — the strongest signal; extra for prefix / word start.
  const at = t.indexOf(q);
  if (at >= 0) {
    let score = 100 + q.length * 4 - Math.min(at, 20) + lengthBonus(t);
    if (at === 0)
      score += 40; // prefix — covers ID prefixes ("task-9…")
    else if (isWordStart(t, at)) score += 20;
    const positions = Array.from({ length: q.length }, (_, k) => at + k);
    return { score, positions };
  }

  // Greedy left-to-right subsequence scan. When the next raw occurrence sits
  // mid-word, prefer a word-start occurrence within the next 16 chars so
  // "nro" finds "Nav Rail Order" rather than scattering.
  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    let hit = t.indexOf(ch, ti);
    if (hit < 0) return null;
    if (hit !== prev + 1 && !isWordStart(t, hit)) {
      const limit = Math.min(t.length, hit + 16);
      for (let j = hit + 1; j < limit; j++) {
        if (t[j] === ch && isWordStart(t, j)) {
          hit = j;
          break;
        }
      }
    }
    if (hit === prev + 1)
      score += 8; // consecutive-run bonus
    else score -= Math.min(hit - ti, 10); // gap penalty
    if (isWordStart(t, hit)) score += 10;
    positions.push(hit);
    prev = hit;
    ti = hit + 1;
  }
  return { score: score + lengthBonus(t), positions };
}
