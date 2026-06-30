/**
 * findings-parser.ts — Parse .claude/review-findings.md and .claude/test-findings.md (TASK-025)
 *
 * Best-effort parse — extract what's reliably there:
 *   review: latestVerdict (APPROVE/CHANGES-NEEDED), openCriticals ([CRITICAL] count)
 *   test: lastRun (date from section heading), pass/fail counts from "N/N" patterns
 *
 * Empty state: missing file → nulls / 0.
 *
 * contract:console-http-api, TASK-025
 */

import { readFileSync, existsSync } from "node:fs";
import type { FindingsSummary } from "../types.js";

// Matches verdict lines, e.g. "**VERDICT: APPROVE**" or "VERDICT: CHANGES-NEEDED"
const VERDICT_RE = /VERDICT.*?(APPROVE|CHANGES-NEEDED|APPROVED)/i;

// A line is an OPEN critical if it carries a [CRITICAL] tag and is NOT marked
// resolved. review-findings.md is an append-only HISTORICAL log, so a fixed
// finding stays in the file forever — counting every [CRITICAL] string would
// report long-resolved criticals as still-open (violates DEC-018: honest
// derived data). Convention: annotate a resolved critical's line with
// "RESOLVED" (or strike it through with ~~) and it drops out of the open count.
const CRITICAL_TAG_RE = /\[CRITICAL\]/i;
const RESOLVED_RE = /\bRESOLVED\b|~~/i;

// Match a date heading like "## 2026-06-24 — ..." or "## 2026-06-24"
const DATE_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})/;

// Match pass/fail counts like "377 tests" or "N/N" patterns
const PASS_FAIL_RE = /(\d+)\s*(?:passing|pass(?:ed)?)|(?:tests?.*?(\d+)\s+pass)/i;
const FAIL_COUNT_RE = /(\d+)\s*(?:failing|fail(?:ed)?|failed)/i;
const FRACTION_RE = /(\d+)\/(\d+)\s*(?:pass|green|ok)/i;

/**
 * Parse review-findings.md content.
 * Exported for unit testing.
 */
export function parseReviewFindingsMd(content: string): {
  latestVerdict: string | null;
  openCriticals: number;
} {
  if (!content.trim()) {
    return { latestVerdict: null, openCriticals: 0 };
  }

  const verdictMatch = VERDICT_RE.exec(content);
  const latestVerdict = verdictMatch ? verdictMatch[1].toUpperCase() : null;

  // Count only UNRESOLVED criticals — skip any [CRITICAL] line marked resolved.
  let openCriticals = 0;
  for (const line of content.split(/\r?\n/)) {
    if (CRITICAL_TAG_RE.test(line) && !RESOLVED_RE.test(line)) openCriticals++;
  }

  return { latestVerdict, openCriticals };
}

/**
 * Parse test-findings.md content.
 * Exported for unit testing.
 */
export function parseTestFindingsMd(content: string): {
  lastRun: string | null;
  pass: number | null;
  fail: number | null;
} {
  if (!content.trim()) {
    return { lastRun: null, pass: null, fail: null };
  }

  // Find the first date heading (newest test run, since newest-first)
  let lastRun: string | null = null;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const m = DATE_HEADING_RE.exec(line);
    if (m) {
      lastRun = m[1];
      break;
    }
  }

  // Best-effort pass/fail extraction
  let pass: number | null = null;
  let fail: number | null = null;

  const fractionMatch = FRACTION_RE.exec(content);
  if (fractionMatch) {
    pass = parseInt(fractionMatch[1], 10);
  }

  const passMatch = PASS_FAIL_RE.exec(content);
  if (passMatch && pass === null) {
    pass = parseInt(passMatch[1] || passMatch[2], 10) || null;
  }

  const failMatch = FAIL_COUNT_RE.exec(content);
  if (failMatch) {
    fail = parseInt(failMatch[1], 10);
  }

  return { lastRun, pass, fail };
}

/**
 * Read and parse both findings files.
 * Returns nulls/0 when files are absent.
 */
export function parseFindingsFiles(
  reviewPath: string,
  testPath: string
): FindingsSummary {
  let reviewContent = "";
  let testContent = "";

  if (existsSync(reviewPath)) {
    try {
      reviewContent = readFileSync(reviewPath, "utf8");
    } catch (err) {
      console.warn(`[console] failed to read ${reviewPath}: ${String(err)}`);
    }
  }

  if (existsSync(testPath)) {
    try {
      testContent = readFileSync(testPath, "utf8");
    } catch (err) {
      console.warn(`[console] failed to read ${testPath}: ${String(err)}`);
    }
  }

  const review = parseReviewFindingsMd(reviewContent);
  const test = parseTestFindingsMd(testContent);

  return { review, test };
}
