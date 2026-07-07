/**
 * fuzzy.test.ts — the ⌘K palette's subsequence scorer (§2.10, TASK-103).
 */

import { describe, it, expect } from "vitest";
import { fuzzyScore } from "../src/app/lib/fuzzy";

function score(q: string, t: string): number {
  const m = fuzzyScore(q, t);
  if (!m) throw new Error(`expected "${q}" to match "${t}"`);
  return m.score;
}

describe("fuzzyScore — matching", () => {
  it("rejects non-subsequences", () => {
    expect(fuzzyScore("xyz", "task board")).toBeNull();
    expect(fuzzyScore("kanban", "kanba")).toBeNull(); // query longer than text
    expect(fuzzyScore("ba", "ab")).toBeNull(); // order matters
  });

  it("matches the empty query against anything (score 0)", () => {
    expect(fuzzyScore("", "whatever")).toEqual({ score: 0, positions: [] });
    expect(fuzzyScore("   ", "whatever")).toEqual({ score: 0, positions: [] });
  });

  it("is case-insensitive both ways", () => {
    expect(fuzzyScore("TASK", "task-092")).not.toBeNull();
    expect(fuzzyScore("task", "TASK-092")).not.toBeNull();
  });

  it("accepts any in-order subsequence", () => {
    expect(fuzzyScore("nro", "Nav Rail Order")).not.toBeNull();
    expect(fuzzyScore("cmdk", "Command K palette")).not.toBeNull();
  });
});

describe("fuzzyScore — ranking", () => {
  it("prefix (ID-prefix case) outranks the same substring mid-string", () => {
    expect(score("task-0", "TASK-092")).toBeGreaterThan(
      score("task-0", "xx task-092 copy"),
    );
    // and the digit-skipping form still MATCHES the ID at all
    expect(fuzzyScore("task-9", "TASK-092")).not.toBeNull();
  });

  it("exact substring outranks a scattered subsequence", () => {
    expect(score("board", "task board")).toBeGreaterThan(
      score("board", "big orange android"),
    );
  });

  it("word-start subsequence outranks mid-word scatter", () => {
    expect(score("sb", "Status Bar")).toBeGreaterThan(score("sb", "absorb"));
  });

  it("consecutive runs outrank gapped matches", () => {
    expect(score("nav", "xx nav yy")).toBeGreaterThan(score("nav", "nX aX v"));
  });

  it("shorter targets win at equal match quality", () => {
    expect(score("dash", "Dashboard")).toBeGreaterThan(
      score("dash", "Dashboard configuration and layout settings"),
    );
  });
});

describe("fuzzyScore — positions (highlighting)", () => {
  it("returns contiguous positions for substring hits", () => {
    const m = fuzzyScore("dash", "Go to Dashboard");
    expect(m?.positions).toEqual([6, 7, 8, 9]);
  });

  it("returns in-order positions into the original text for subsequences", () => {
    const m = fuzzyScore("nro", "Nav Rail Order");
    expect(m).not.toBeNull();
    const pos = m!.positions;
    expect(pos).toHaveLength(3);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos); // strictly in order
    // each position actually holds the matched character
    const t = "Nav Rail Order".toLowerCase();
    expect(pos.map((p) => t[p]).join("")).toBe("nro");
  });
});
