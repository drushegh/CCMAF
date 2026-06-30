/**
 * schema.ts — Types and hand-validation for contract:console-verify-file.
 *
 * No external schema library. Every rule is stated explicitly so the
 * validation error messages match the contract prose exactly.
 *
 * Business rules (from ECOSYSTEM.md contract:console-verify-file):
 *   - schemaVersion must be 1
 *   - verdict ∈ { pending, pass, fail, warn, blocked }
 *   - severity is non-null ONLY when verdict ∈ { fail, warn }
 *   - severity ∈ { P0, P1, P2, P3, null }
 *   - status ∈ { in-review, processing-fixes, done }
 *   - task must match ^(TASK|BUG)-[0-9]+$
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type Verdict = "pending" | "pass" | "fail" | "warn" | "blocked";
export type Severity = "P0" | "P1" | "P2" | "P3" | null;
export type FileStatus = "in-review" | "processing-fixes" | "done";

/**
 * One round of notes for a use case. The verify loop is iterative: a use case
 * the author flags as a bug comes back as `pending` after the fix, opening a NEW
 * round so the prior round's notes are preserved (never overwritten). The current
 * (editable) note is the last entry; earlier entries are the history.
 */
export interface NoteRound {
  round: number; // 1-based
  note: string;
}

export interface VerifyItem {
  id: string;
  kind: string;
  group?: string;
  title: string;
  subject?: string;
  expected?: string;
  verdict: Verdict;
  severity?: Severity;
  /**
   * LEGACY single note. Kept for back-compat; mirrors the CURRENT round's note.
   * New writes should treat `noteRounds` as canonical — `notes` is derived from
   * the last round on write so old readers still see the latest note.
   */
  notes?: string;
  /**
   * Per-round notes (current = last). Absent on legacy files — `normalizeItem`
   * seeds it from `notes` (or empty) so every item has at least round 1.
   */
  noteRounds?: NoteRound[];
  /** Current retest round (1 = first test; +1 each bug→fix→retest cycle). */
  round?: number;
  /**
   * The BUG-XXX raised for this use case while it's failing. Set when the author
   * flags a bug; cleared (the reset reconcile) once that bug reaches Done in
   * TASKS.md and the use case flips back to `pending` for a retest.
   */
  bugId?: string | null;
  changed?: boolean;
  provenance?: Record<string, unknown>;
}

export interface VerifyFile {
  schemaVersion: 1;
  task: string;
  branch?: string;
  build?: string;
  status: FileStatus;
  items: VerifyItem[];
}

// ── Validation constants ─────────────────────────────────────────────────────

const VALID_VERDICTS = new Set<string>(["pending", "pass", "fail", "warn", "blocked"]);
const SEVERITY_VERDICTS = new Set<string>(["fail", "warn"]);
const VALID_SEVERITIES = new Set<string | null>(["P0", "P1", "P2", "P3", null]);
const VALID_STATUSES = new Set<string>(["in-review", "processing-fixes", "done"]);
const TASK_ID_RE = /^(TASK|BUG)-[0-9]+$/;
const BUG_ID_RE = /^BUG-[0-9]+$/;

// ── Validation result ─────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Item-level validation ─────────────────────────────────────────────────────

function validateItem(item: unknown, index: number): string[] {
  const errors: string[] = [];
  const prefix = `items[${index}]`;

  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    errors.push(`${prefix}: must be an object`);
    return errors;
  }

  const obj = item as Record<string, unknown>;

  if (typeof obj["id"] !== "string" || obj["id"].length === 0) {
    errors.push(`${prefix}.id: must be a non-empty string`);
  }
  if (typeof obj["kind"] !== "string" || obj["kind"].length === 0) {
    errors.push(`${prefix}.kind: must be a non-empty string`);
  }
  if (typeof obj["title"] !== "string" || obj["title"].length === 0) {
    errors.push(`${prefix}.title: must be a non-empty string`);
  }

  // verdict required + enum
  if (!("verdict" in obj)) {
    errors.push(`${prefix}.verdict: required`);
  } else if (typeof obj["verdict"] !== "string" || !VALID_VERDICTS.has(obj["verdict"])) {
    errors.push(
      `${prefix}.verdict: must be one of pending|pass|fail|warn|blocked, got ${JSON.stringify(obj["verdict"])}`
    );
  } else {
    // severity: non-null only on fail/warn
    const verdict = obj["verdict"] as string;
    const severity = "severity" in obj ? obj["severity"] : undefined;

    if (severity !== undefined) {
      if (!VALID_SEVERITIES.has(severity as string | null)) {
        errors.push(
          `${prefix}.severity: must be P0|P1|P2|P3|null, got ${JSON.stringify(severity)}`
        );
      } else if (severity !== null && !SEVERITY_VERDICTS.has(verdict)) {
        // severity non-null on a non-fail/warn verdict
        errors.push(
          `${prefix}.severity: must be null when verdict is '${verdict}' (non-null only on fail|warn)`
        );
      }
    }
  }

  // optional fields: type-check only (not required)
  if ("group" in obj && obj["group"] !== undefined && typeof obj["group"] !== "string") {
    errors.push(`${prefix}.group: must be a string`);
  }
  if ("subject" in obj && obj["subject"] !== undefined && typeof obj["subject"] !== "string") {
    errors.push(`${prefix}.subject: must be a string`);
  }
  if ("expected" in obj && obj["expected"] !== undefined && typeof obj["expected"] !== "string") {
    errors.push(`${prefix}.expected: must be a string`);
  }
  if ("notes" in obj && obj["notes"] !== undefined && typeof obj["notes"] !== "string") {
    errors.push(`${prefix}.notes: must be a string`);
  }
  if ("changed" in obj && obj["changed"] !== undefined && typeof obj["changed"] !== "boolean") {
    errors.push(`${prefix}.changed: must be a boolean`);
  }

  // retest-loop fields (all optional; legacy files omit them)
  if ("round" in obj && obj["round"] !== undefined) {
    const r = obj["round"];
    if (typeof r !== "number" || !Number.isInteger(r) || r < 1) {
      errors.push(`${prefix}.round: must be a positive integer`);
    }
  }
  if ("bugId" in obj && obj["bugId"] !== undefined && obj["bugId"] !== null) {
    if (typeof obj["bugId"] !== "string" || !BUG_ID_RE.test(obj["bugId"])) {
      errors.push(`${prefix}.bugId: must be null or match BUG-[0-9]+`);
    }
  }
  if ("noteRounds" in obj && obj["noteRounds"] !== undefined) {
    if (!Array.isArray(obj["noteRounds"])) {
      errors.push(`${prefix}.noteRounds: must be an array`);
    } else {
      obj["noteRounds"].forEach((nr, j) => {
        if (typeof nr !== "object" || nr === null) {
          errors.push(`${prefix}.noteRounds[${j}]: must be an object`);
          return;
        }
        const round = (nr as Record<string, unknown>)["round"];
        const note = (nr as Record<string, unknown>)["note"];
        if (typeof round !== "number" || !Number.isInteger(round) || round < 1) {
          errors.push(`${prefix}.noteRounds[${j}].round: must be a positive integer`);
        }
        if (typeof note !== "string") {
          errors.push(`${prefix}.noteRounds[${j}].note: must be a string`);
        }
      });
    }
  }

  return errors;
}

// ── File-level validation ─────────────────────────────────────────────────────

/**
 * Validate a parsed JSON object against contract:console-verify-file.
 * Returns { valid, errors }. Pure — no I/O.
 */
export function validateVerifyFile(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { valid: false, errors: ["root: must be an object"] };
  }

  const obj = data as Record<string, unknown>;

  // schemaVersion
  if (!("schemaVersion" in obj)) {
    errors.push("schemaVersion: required");
  } else if (obj["schemaVersion"] !== 1) {
    errors.push(`schemaVersion: must be 1, got ${JSON.stringify(obj["schemaVersion"])}`);
  }

  // task
  if (!("task" in obj)) {
    errors.push("task: required");
  } else if (typeof obj["task"] !== "string" || !TASK_ID_RE.test(obj["task"])) {
    errors.push(
      `task: must match (TASK|BUG)-[0-9]+, got ${JSON.stringify(obj["task"])}`
    );
  }

  // status
  if (!("status" in obj)) {
    errors.push("status: required");
  } else if (typeof obj["status"] !== "string" || !VALID_STATUSES.has(obj["status"])) {
    errors.push(
      `status: must be in-review|processing-fixes|done, got ${JSON.stringify(obj["status"])}`
    );
  }

  // items
  if (!("items" in obj)) {
    errors.push("items: required");
  } else if (!Array.isArray(obj["items"])) {
    errors.push("items: must be an array");
  } else {
    for (let i = 0; i < obj["items"].length; i++) {
      errors.push(...validateItem(obj["items"][i], i));
    }
  }

  // optional top-level strings
  if ("branch" in obj && obj["branch"] !== undefined && typeof obj["branch"] !== "string") {
    errors.push("branch: must be a string");
  }
  if ("build" in obj && obj["build"] !== undefined && typeof obj["build"] !== "string") {
    errors.push("build: must be a string");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Assert a parsed object is a valid VerifyFile.
 * Throws with the list of errors on failure.
 */
export function assertVerifyFile(data: unknown): VerifyFile {
  const { valid, errors } = validateVerifyFile(data);
  if (!valid) {
    throw new Error(`Invalid verify file:\n  ${errors.join("\n  ")}`);
  }
  return data as VerifyFile;
}

// ── Migration / normalisation ──────────────────────────────────────────────────

/**
 * Fill the retest-loop defaults so every item is uniform in memory, regardless
 * of whether it came from a legacy pass-file (no round/noteRounds/bugId). Pure.
 *   - round   → 1 if absent
 *   - bugId   → null if absent
 *   - noteRounds → seeded from the legacy `notes` (or one empty round)
 *   - notes   → mirrored from the current (last) round so old readers still work
 */
export function normalizeItem(item: VerifyItem): VerifyItem {
  const round = typeof item.round === "number" && item.round >= 1 ? item.round : 1;
  let noteRounds: NoteRound[] =
    Array.isArray(item.noteRounds) && item.noteRounds.length > 0
      ? item.noteRounds.map((nr) => ({ round: nr.round, note: nr.note }))
      : [{ round: 1, note: item.notes ?? "" }];
  // Guarantee a round entry up to `round` so the current box exists.
  if (!noteRounds.some((nr) => nr.round === round)) {
    noteRounds = [...noteRounds, { round, note: "" }];
  }
  noteRounds.sort((a, b) => a.round - b.round);
  const currentNote = noteRounds[noteRounds.length - 1]?.note ?? "";
  return {
    ...item,
    round,
    bugId: item.bugId ?? null,
    noteRounds,
    notes: currentNote,
  };
}

/** Normalise every item in a file (see normalizeItem). Pure. */
export function normalizeVerifyFile(file: VerifyFile): VerifyFile {
  return { ...file, items: file.items.map(normalizeItem) };
}

/**
 * Validate a VerdictPatch entry (used in PUT body).
 * Returns an error string or null if valid.
 */
export function validateVerdictPatch(
  patch: unknown,
  index: number
): string | null {
  const prefix = `patch[${index}]`;

  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return `${prefix}: must be an object`;
  }
  const p = patch as Record<string, unknown>;

  if (typeof p["id"] !== "string" || p["id"].length === 0) {
    return `${prefix}.id: must be a non-empty string`;
  }
  if (!("verdict" in p)) {
    return `${prefix}.verdict: required`;
  }
  if (typeof p["verdict"] !== "string" || !VALID_VERDICTS.has(p["verdict"])) {
    return `${prefix}.verdict: must be one of pending|pass|fail|warn|blocked`;
  }

  // severity: if present, must be valid and respect the fail/warn rule
  if ("severity" in p && p["severity"] !== undefined) {
    const verdict = p["verdict"] as string;
    const sev = p["severity"];
    if (!VALID_SEVERITIES.has(sev as string | null)) {
      return `${prefix}.severity: must be P0|P1|P2|P3|null`;
    }
    if (sev !== null && sev !== undefined && !SEVERITY_VERDICTS.has(verdict)) {
      return `${prefix}.severity: non-null severity only allowed on fail|warn`;
    }
  }

  if ("notes" in p && p["notes"] !== undefined && typeof p["notes"] !== "string") {
    return `${prefix}.notes: must be a string`;
  }

  if ("bugId" in p && p["bugId"] !== undefined && p["bugId"] !== null) {
    if (typeof p["bugId"] !== "string" || !BUG_ID_RE.test(p["bugId"])) {
      return `${prefix}.bugId: must be null or match BUG-[0-9]+`;
    }
  }

  return null;
}
