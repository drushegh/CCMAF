/**
 * transcript-parser.ts — Read Claude Code's on-disk JSONL transcripts into the
 * Sessions agent-visualisation shapes (session list, agent tree, conversation).
 *
 * Ground truth (verified against live transcripts, Claude Code 2.1.x):
 *   ~/.claude/projects/<slug>/<sessionId>.jsonl            — main transcript
 *   ~/.claude/projects/<slug>/<sessionId>/subagents/
 *     agent-<id>.jsonl                                     — one per subagent
 *     agent-<id>.meta.json                                 — sidecar:
 *       { agentType, description, toolUseId, spawnDepth }
 *
 *   <slug> = project cwd with every char not [a-zA-Z0-9] replaced by "-"
 *   (verified empirically across 25 live project dirs). Case comes from the
 *   RECORDED cwd, which may differ from ours (drive letter f: vs F:), so
 *   resolution falls back to a case-insensitive dir-name match and finally to
 *   matching each candidate dir's recorded `cwd` (every jsonl line carries it).
 *
 *   Tree linkage: a subagent's meta.toolUseId matches a Task/Agent tool_use
 *   block id in the transcript of WHOEVER spawned it (main session → root,
 *   another agent → nested). Liveness: a matching tool_result whose line-level
 *   `toolUseResult.status === "completed"` ⇒ done. Background spawns get an
 *   IMMEDIATE ack result (`status: "async_launched"`) which does NOT mean done
 *   — completion arrives later as a `<task-notification>` queued_command line.
 *   Fallback: recent file mtime ⇒ running, stale ⇒ done.
 *
 *   Renames (§4.3 / BUG-018, verified live on 2.1.202): a manual session
 *   rename in the VS Code extension persists as
 *     {"type":"custom-title","customTitle":"…","sessionId":"…"}
 *   lines APPENDED to the main transcript (re-emitted as the session goes on,
 *   so the newest rides near the tail). The ~/.claude/sessions/<pid>.json
 *   index is NOT updated by a rename — its `nameSource` stays "derived" — so
 *   it is useless as a rename source. listSessions therefore scans the head
 *   window AND a bounded tail window for the LAST custom-title, and caches
 *   every observed name in a machine-local sidecar
 *   (<userStateDir()>/session-names.json) so a name survives the rare case
 *   of the line falling outside both windows on a later listing.
 *
 * READ-ONLY: pure `(path) → data` functions, fs reads only, defensive per-line
 * JSON.parse (a malformed line is skipped, never thrown on). ONE deliberate
 * exception: the machine-local rename sidecar above is written (best-effort,
 * atomically) when a rename is observed — never a project or transcript file.
 *
 * contract:console-http-api
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { userStateDir } from "../hub/registry.js";
import type {
  AgentConversation,
  AgentNode,
  AgentStatus,
  ConversationTurn,
  SearchMatch,
  SessionSearchResult,
  SessionSummary,
  SessionTitleSource,
  SessionTree,
  ToolResultDetail,
  TurnBlock,
} from "../types.js";

// ── Tunables ──────────────────────────────────────────────────────────────────

/** An agent file modified within this window (and not provably finished) is
 *  considered running. Agents write constantly while working, so 2 minutes of
 *  silence is a safe "no longer running" signal. */
const RUNNING_THRESHOLD_MS = 120_000;

/** Bytes of a main transcript's head scanned for startedAt / branch / first
 *  prompt in listSessions (bounded so a 70MB transcript stays cheap to list). */
const HEAD_SCAN_BYTES = 512 * 1024;

/** Bytes of a main transcript's TAIL scanned for the newest custom-title
 *  (rename) line in listSessions — renames are appended and re-emitted
 *  (observed ~every few KB of activity), so a bounded tail window is
 *  reliable; the sidecar cache covers the residual miss. */
const TAIL_SCAN_BYTES = 256 * 1024;

/** Chunk size for the raw message-count scan of large main transcripts. */
const COUNT_CHUNK_BYTES = 1024 * 1024;

/** Display truncation caps (chars). */
const TEXT_CAP = 8000;
const THINKING_CAP = 2000;
const TOOL_RESULT_CAP = 2000;
const TOOL_SUMMARY_CAP = 300;
const FIRST_PROMPT_CAP = 160;

/** Default conversation window size (tail / before-cursor chunk). */
const DEFAULT_CONVERSATION_LIMIT = 200;

/** Max in-session search matches returned (older hits beyond this are dropped). */
const SEARCH_MATCH_CAP = 200;
/** Chars of context on each side of a search hit (~120-char snippet). */
const SNIPPET_RADIUS = 60;

/** Options shared by the public functions — everything injectable for tests. */
export interface TranscriptOpts {
  /** Claude's projects dir. Default: $CLAUDE_PROJECTS_DIR or ~/.claude/projects. */
  projectsDir?: string;
  /** "Now" for liveness checks (ms epoch). Default: Date.now(). */
  now?: number;
  /** Liveness window (ms). Default: RUNNING_THRESHOLD_MS. */
  runningThresholdMs?: number;
}

/** readAgentConversation options: projectsDir + the pagination window. */
export interface ReadConversationOpts extends TranscriptOpts {
  /**
   * uuid of a turn to page BEFORE. Omitted → the tail (last `limit` turns);
   * present → the `limit` turns immediately before that turn. An unknown uuid
   * yields an empty window (dead cursor).
   */
  before?: string;
  /** Window size. Default DEFAULT_CONVERSATION_LIMIT; clamped to >= 1. */
  limit?: number;
  /** Escape hatch: return the FULL conversation, ignoring before/limit. */
  all?: boolean;
}

// ── Generic line helpers ──────────────────────────────────────────────────────

/** One parsed transcript line (shape is version-fluid — treat as loose JSON). */
type Line = Record<string, unknown>;

/** Parse a JSONL string content tolerantly: malformed lines are skipped. */
function* parseLines(content: string): Generator<Line> {
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as unknown;
      if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
        yield obj as Line;
      }
    } catch {
      // Malformed line — skip (transcripts are appended live; a torn tail
      // line during an active session is normal, not an error).
    }
  }
}

// ── Per-file stat-keyed caches ───────────────────────────────────────────────
//
// Every read here is O(file): a 74MB transcript costs ~0.5-1s to read + parse,
// and the SPA refetches the whole session view on ANY `.claude` change (incl.
// telemetry, which churns on every tool use), while listSessions byte-scans
// EVERY transcript per call. Almost all of those repeats hit an UNCHANGED file.
// Keying a cache on (path, mtimeMs, size) turns each such repeat into an
// in-memory hit — the read + JSON.parse (the expensive parts) run once per file
// version. A changed transcript (new mtime OR size) misses and recomputes, so a
// live session is never served stale; transcripts are append-only, so a size
// change accompanies every real edit. Caches are bounded (LRU) so memory can't
// grow without limit.

interface StatToken {
  mtimeMs: number;
  size: number;
}

/** (mtimeMs, size) identity of a file; null when it can't be stat'd / isn't a file. */
function statToken(filePath: string): StatToken | null {
  try {
    const st = statSync(filePath);
    if (!st.isFile()) return null;
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

// readJsonl cache: byte-size-bounded (parsed line arrays are large).
interface JsonlSlot extends StatToken {
  lines: Line[];
}
const jsonlCache = new Map<string, JsonlSlot>(); // insertion order = LRU
let jsonlCacheBytes = 0;
/** File-size budget (a proxy for the parsed footprint) for the readJsonl cache. */
const JSONL_CACHE_MAX_BYTES = 96 * 1024 * 1024;

// Small-value caches: bounded by entry count (counts / heads are tiny).
interface ValueSlot<T> extends StatToken {
  value: T;
}
const countCache = new Map<string, ValueSlot<number>>();
const headCache = new Map<string, ValueSlot<string>>();
const SMALL_CACHE_MAX_ENTRIES = 1024;

function smallCacheGet<T>(
  cache: Map<string, ValueSlot<T>>,
  key: string,
  tok: StatToken | null,
): { hit: true; value: T } | { hit: false } {
  if (!tok) return { hit: false };
  const slot = cache.get(key);
  if (slot && slot.mtimeMs === tok.mtimeMs && slot.size === tok.size) {
    cache.delete(key); // LRU touch
    cache.set(key, slot);
    return { hit: true, value: slot.value };
  }
  return { hit: false };
}

function smallCacheSet<T>(
  cache: Map<string, ValueSlot<T>>,
  key: string,
  tok: StatToken | null,
  value: T,
): void {
  if (!tok) return;
  cache.delete(key);
  cache.set(key, { mtimeMs: tok.mtimeMs, size: tok.size, value });
  while (cache.size > SMALL_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Drop every cached parse/count/head. For tests (isolation) + hard invalidation. */
export function clearTranscriptCaches(): void {
  jsonlCache.clear();
  jsonlCacheBytes = 0;
  countCache.clear();
  headCache.clear();
  namesCache = null;
}

/**
 * Read + tolerantly parse a whole JSONL file; [] when unreadable/absent.
 * Cached by (path, mtimeMs, size): an unchanged file is parsed once, then served
 * from memory. The returned array is SHARED — callers treat it read-only (they
 * build fresh structures from it; none mutate a Line or the array itself).
 */
function readJsonl(filePath: string): Line[] {
  const tok = statToken(filePath);
  if (tok) {
    const slot = jsonlCache.get(filePath);
    if (slot && slot.mtimeMs === tok.mtimeMs && slot.size === tok.size) {
      jsonlCache.delete(filePath); // LRU touch
      jsonlCache.set(filePath, slot);
      return slot.lines;
    }
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const lines = Array.from(parseLines(content));

  // Cache only when stat'able and the file fits the budget (a single over-budget
  // file is read through uncached rather than evicting everything else).
  if (tok && tok.size <= JSONL_CACHE_MAX_BYTES) {
    const prev = jsonlCache.get(filePath);
    if (prev) jsonlCacheBytes -= prev.size;
    jsonlCache.delete(filePath);
    jsonlCache.set(filePath, { mtimeMs: tok.mtimeMs, size: tok.size, lines });
    jsonlCacheBytes += tok.size;
    // Evict oldest (front of the Map) until under budget — never the entry just
    // inserted at the back (a single file is guaranteed <= budget here).
    while (jsonlCacheBytes > JSONL_CACHE_MAX_BYTES) {
      const oldest = jsonlCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const e = jsonlCache.get(oldest);
      jsonlCache.delete(oldest);
      if (e) jsonlCacheBytes -= e.size;
    }
  }
  return lines;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** message object of a line ({} when absent/invalid). */
function messageOf(line: Line): Record<string, unknown> {
  const m = line.message;
  return m !== null && typeof m === "object" && !Array.isArray(m)
    ? (m as Record<string, unknown>)
    : {};
}

/** Content blocks of a line's message (list form), else []. */
function blocksOf(line: Line): Record<string, unknown>[] {
  const c = messageOf(line).content;
  if (!Array.isArray(c)) return [];
  return c.filter(
    (b): b is Record<string, unknown> => b !== null && typeof b === "object",
  );
}

// ── Project dir resolution (slug + cwd-match fallback) ───────────────────────

/** Default projects dir: $CLAUDE_PROJECTS_DIR (tests/overrides) or the real one. */
export function defaultProjectsDir(): string {
  return (
    process.env.CLAUDE_PROJECTS_DIR || join(homedir(), ".claude", "projects")
  );
}

/**
 * Claude Code's path→slug rule: every char not [a-zA-Z0-9] becomes "-".
 * Verified empirically: F:\Git\...\claude-code-multi-agent-framework recorded
 * with cwd "f:\Git\..." slugs to "f--Git-Personal-claude-code-multi-agent-framework".
 */
export function pathToSlug(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Normalise a path for cwd comparison: lowercase, forward slashes, no trailing /. */
function normaliseForCompare(p: string): string {
  return p
    .replace(/[\\/]+/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** First recorded `cwd` in the newest .jsonl of a candidate dir (head only). */
function firstCwdOf(dirPath: string): string | null {
  let newest: { path: string; mtimeMs: number } | null = null;
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const p = join(dirPath, name);
    try {
      const st = statSync(p);
      if (!st.isFile()) continue;
      if (!newest || st.mtimeMs > newest.mtimeMs) {
        newest = { path: p, mtimeMs: st.mtimeMs };
      }
    } catch {
      // race with deletion — skip
    }
  }
  if (!newest) return null;
  for (const line of parseLines(readHead(newest.path, 64 * 1024))) {
    const cwd = str(line.cwd);
    if (cwd) return cwd;
  }
  return null;
}

/**
 * Resolve the sessions dir for a project root.
 * Order: exact slug → case-insensitive slug match → cwd-match scan (each
 * candidate dir's newest transcript records the cwd it ran in). Returns null
 * when the project has no recorded sessions.
 */
export function resolveProjectSessionsDir(
  projectRoot: string,
  opts?: TranscriptOpts,
): string | null {
  const projectsDir = opts?.projectsDir ?? defaultProjectsDir();
  if (!existsSync(projectsDir)) return null;

  // 1. Exact slug.
  const slug = pathToSlug(projectRoot);
  const exact = join(projectsDir, slug);
  if (existsSync(exact)) return exact;

  let entries: string[];
  try {
    entries = readdirSync(projectsDir);
  } catch {
    return null;
  }

  // 2. Case-insensitive slug (Windows records "f:\…" while process.cwd()
  //    reports "F:\…" — same dir, different slug case).
  const slugLower = slug.toLowerCase();
  for (const name of entries) {
    if (name.toLowerCase() === slugLower) {
      const p = join(projectsDir, name);
      try {
        if (statSync(p).isDirectory()) return p;
      } catch {
        // skip
      }
    }
  }

  // 3. cwd-match scan — robust against any future slug-rule change.
  const wanted = normaliseForCompare(projectRoot);
  for (const name of entries) {
    const p = join(projectsDir, name);
    try {
      if (!statSync(p).isDirectory()) continue;
    } catch {
      continue;
    }
    const cwd = firstCwdOf(p);
    if (cwd && normaliseForCompare(cwd) === wanted) return p;
  }

  return null;
}

// ── Bounded head read + raw message counting (large-file safety) ─────────────

/** Read up to `maxBytes` from the start of a file as utf8 ("" on error). */
function readHeadUncached(filePath: string, maxBytes: number): string {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return "";
  }
  try {
    const buf = Buffer.alloc(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    return buf.toString("utf8", 0, n);
  } catch {
    return "";
  } finally {
    closeSync(fd);
  }
}

/** Cached readHead — keyed by (path, mtimeMs, size, maxBytes). */
function readHead(filePath: string, maxBytes: number): string {
  const key = `${filePath}\0${maxBytes}`;
  const tok = statToken(filePath);
  const cached = smallCacheGet(headCache, key, tok);
  if (cached.hit) return cached.value;
  const value = readHeadUncached(filePath, maxBytes);
  smallCacheSet(headCache, key, tok, value);
  return value;
}

/** Read up to `maxBytes` from the END of a file as utf8 ("" on error). The
 *  window usually starts mid-line — parseLines skips the torn first line. */
function readTailUncached(filePath: string, maxBytes: number): string {
  const tok = statToken(filePath);
  if (!tok) return "";
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return "";
  }
  try {
    const want = Math.min(maxBytes, tok.size);
    if (want <= 0) return "";
    const buf = Buffer.alloc(want);
    const n = readSync(fd, buf, 0, want, Math.max(0, tok.size - want));
    return buf.toString("utf8", 0, n);
  } catch {
    return "";
  } finally {
    closeSync(fd);
  }
}

/** Cached readTail — shares the head cache, disambiguated by a "tail" key. */
function readTail(filePath: string, maxBytes: number): string {
  const key = `${filePath}\0tail\0${maxBytes}`;
  const tok = statToken(filePath);
  const cached = smallCacheGet(headCache, key, tok);
  if (cached.hit) return cached.value;
  const value = readTailUncached(filePath, maxBytes);
  smallCacheSet(headCache, key, tok, value);
  return value;
}

/**
 * Count `"type":"user"` / `"type":"assistant"` occurrences by scanning raw
 * bytes in chunks — a 70MB transcript is counted without parsing (or holding)
 * it. Exact for well-formed transcript lines: Claude Code writes compact
 * JSON.stringify output, and inside embedded JSON strings quotes are escaped
 * (\"), so the bare-quote needle can't match nested content. Verified equal
 * to a full parse on live multi-MB transcripts.
 */
function countMessagesRawUncached(filePath: string): number {
  const needles = [
    Buffer.from('"type":"user"'),
    Buffer.from('"type":"assistant"'),
  ];
  const carryLen = Math.max(...needles.map((n) => n.length)) - 1;

  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return 0;
  }
  let count = 0;
  try {
    const chunk = Buffer.alloc(COUNT_CHUNK_BYTES);
    let carry = Buffer.alloc(0);
    let pos = 0;
    for (;;) {
      const n = readSync(fd, chunk, 0, COUNT_CHUNK_BYTES, pos);
      if (n <= 0) break;
      pos += n;
      // `carry` (the tail of the previous hay) was fully scanned last round.
      // A match lying WHOLLY inside it was already counted — count only matches
      // that end past it. This is why carryLen = max-needle-1 (spanning a
      // boundary) doesn't double-count a SHORTER needle that fits inside carry.
      const carryOffset = carry.length;
      const hay = Buffer.concat([carry, chunk.subarray(0, n)]);
      for (const needle of needles) {
        let i = hay.indexOf(needle);
        while (i !== -1) {
          if (i + needle.length > carryOffset) count++;
          i = hay.indexOf(needle, i + needle.length);
        }
      }
      carry = Buffer.from(hay.subarray(Math.max(0, hay.length - carryLen)));
    }
  } catch {
    // partial count is fine — display metadata only
  } finally {
    closeSync(fd);
  }
  return count;
}

/** Cached message count — keyed by (path, mtimeMs, size). */
export function countMessagesRaw(filePath: string): number {
  const tok = statToken(filePath);
  const cached = smallCacheGet(countCache, filePath, tok);
  if (cached.hit) return cached.value;
  const value = countMessagesRawUncached(filePath);
  smallCacheSet(countCache, filePath, tok, value);
  return value;
}

// ── Rename sidecar (machine-local; <userStateDir()>/session-names.json) ──────
//
// Best-effort cache of observed manual renames: { [sessionId]: {name, seenAt} }.
// Written ONLY when a custom-title is seen in a scan window (see module doc);
// read as ladder fallback when the line has scrolled outside both windows.
// Machine-local by design — never a project/repo file. CCMAF_CONSOLE_STATE_DIR
// (via userStateDir) points it at a temp dir in tests.

interface SessionNameEntry {
  name: string;
  seenAt: string;
}
type SessionNamesFile = Record<string, SessionNameEntry>;

function sessionNamesPath(): string {
  return join(userStateDir(), "session-names.json");
}

let namesCache: { token: StatToken | null; data: SessionNamesFile } | null =
  null;

function tokenEq(a: StatToken | null, b: StatToken | null): boolean {
  if (a === null || b === null) return a === b;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/** Parsed sidecar content ({} when absent/corrupt), stat-key cached. */
function readSessionNames(): SessionNamesFile {
  const p = sessionNamesPath();
  const tok = statToken(p);
  if (namesCache && tokenEq(namesCache.token, tok)) return namesCache.data;
  const data: SessionNamesFile = {};
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (v === null || typeof v !== "object" || Array.isArray(v)) continue;
        const name = str((v as Line).name);
        if (name) data[k] = { name, seenAt: str((v as Line).seenAt) ?? "" };
      }
    }
  } catch {
    // absent / unreadable / corrupt — treat as empty
  }
  namesCache = { token: tok, data };
  return data;
}

/** Persist an observed rename (no-op when unchanged; never throws). */
function rememberSessionName(sessionId: string, name: string): void {
  try {
    const data = readSessionNames();
    if (data[sessionId]?.name === name) return;
    const next: SessionNamesFile = {
      ...data,
      [sessionId]: { name, seenAt: new Date().toISOString() },
    };
    const p = sessionNamesPath();
    mkdirSync(userStateDir(), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
    renameSync(tmp, p); // atomic-ish: readers never see a torn file
    namesCache = { token: statToken(p), data: next };
  } catch {
    // best-effort cache — a listing must never fail over it
  }
}

/** Newest custom-title name for `sessionId` in an already-parsed line window
 *  (null if none). Lines from a copied/forked transcript that name a
 *  DIFFERENT session are ignored. */
function lastCustomTitle(
  lines: Iterable<Line>,
  sessionId: string,
): string | null {
  let name: string | null = null;
  for (const line of lines) {
    if (line.type !== "custom-title") continue;
    const sid = str(line.sessionId);
    if (sid && sid !== sessionId) continue;
    const t = str(line.customTitle);
    if (t) name = t; // keep the LAST — a later rename wins
  }
  return name;
}

// ── First-prompt extraction ───────────────────────────────────────────────────

/** First text of a user line's content (string or first text block). */
function userTextOf(line: Line): string | null {
  const m = messageOf(line);
  const c = m.content;
  if (typeof c === "string") return c.trim() || null;
  for (const b of blocksOf(line)) {
    if (b.type === "text") {
      const t = str(b.text);
      if (t && t.trim()) return t.trim();
    }
  }
  return null;
}

/** True for injected command/caveat XML noise, not a typed prompt. */
function isNoisePrompt(text: string): boolean {
  return text.startsWith("<") || text.startsWith("Caveat:");
}

// ── listSessions ──────────────────────────────────────────────────────────────

/** Session file names are UUIDs; refuse anything path-unsafe. */
const SESSION_ID_RE = /^[0-9a-fA-F][0-9a-fA-F-]{7,63}$/;
/** Subagent ids are short hex tokens (file: agent-<id>.jsonl). */
const AGENT_ID_RE = /^[a-zA-Z0-9]{1,64}$/;

function subagentsDirOf(sessionsDir: string, sessionId: string): string {
  return join(sessionsDir, sessionId, "subagents");
}

/** List `agent-*.jsonl` paths in a session's subagents dir ([] when absent). */
function listAgentFiles(
  sessionsDir: string,
  sessionId: string,
): { id: string; jsonlPath: string; metaPath: string }[] {
  const dir = subagentsDirOf(sessionsDir, sessionId);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: { id: string; jsonlPath: string; metaPath: string }[] = [];
  for (const name of entries.sort()) {
    const m = /^agent-([a-zA-Z0-9]+)\.jsonl$/.exec(name);
    if (!m) continue;
    out.push({
      id: m[1],
      jsonlPath: join(dir, name),
      metaPath: join(dir, `agent-${m[1]}.meta.json`),
    });
  }
  return out;
}

/** One transcript file of a session, with the display label + read discipline. */
interface SessionTranscriptFile {
  agentId: string;
  label: string;
  filePath: string;
  /** Root reads exclude isSidechain lines (old-format interleaving); agents don't. */
  isRoot: boolean;
}

/**
 * Every transcript file of a session — the main transcript ("root") plus one
 * per subagent — in root-first, spawn (file-name) order. Used by the whole-
 * session readers (tool-by-id, search). Meta is read only for subagent labels.
 */
function sessionTranscriptFiles(
  sessionsDir: string,
  sessionId: string,
): SessionTranscriptFile[] {
  const files: SessionTranscriptFile[] = [
    {
      agentId: "root",
      label: "session",
      filePath: join(sessionsDir, `${sessionId}.jsonl`),
      isRoot: true,
    },
  ];
  for (const a of listAgentFiles(sessionsDir, sessionId)) {
    files.push({
      agentId: a.id,
      label: readAgentMeta(a.metaPath).agentType,
      filePath: a.jsonlPath,
      isRoot: false,
    });
  }
  return files;
}

/**
 * List this project's sessions, newest activity first.
 * Empty array when the project has no recorded sessions.
 */
export function listSessions(
  projectRoot: string,
  opts?: TranscriptOpts,
): SessionSummary[] {
  const sessionsDir = resolveProjectSessionsDir(projectRoot, opts);
  if (!sessionsDir) return [];

  let entries: string[];
  try {
    entries = readdirSync(sessionsDir);
  } catch {
    return [];
  }

  const sessions: SessionSummary[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const id = basename(name, ".jsonl");
    if (!SESSION_ID_RE.test(id)) continue;
    const mainPath = join(sessionsDir, name);

    let mtimeMs: number;
    let sizeBytes = 0;
    try {
      const st = statSync(mainPath);
      if (!st.isFile()) continue;
      mtimeMs = st.mtimeMs;
      sizeBytes = st.size;
    } catch {
      continue;
    }

    // Head scan: startedAt, branch, first prompt, title, rename.
    let startedAt: string | null = null;
    let gitBranch: string | null = null;
    let firstPrompt: string | null = null;
    let title: string | null = null;
    let renameTitle: string | null = null;
    for (const line of parseLines(readHead(mainPath, HEAD_SCAN_BYTES))) {
      if (startedAt === null) startedAt = str(line.timestamp);
      if (gitBranch === null) gitBranch = str(line.gitBranch);
      if (title === null && line.type === "ai-title") title = str(line.aiTitle);
      if (title === null && line.type === "summary") title = str(line.summary);
      if (line.type === "custom-title") {
        const sid = str(line.sessionId);
        const t = str(line.customTitle);
        if (t && (!sid || sid === id)) renameTitle = t; // last-in-head wins
      }
      if (firstPrompt === null && line.type === "user" && !line.isMeta) {
        const text = userTextOf(line);
        if (text && !isNoisePrompt(text)) {
          firstPrompt =
            text.length > FIRST_PROMPT_CAP
              ? `${text.slice(0, FIRST_PROMPT_CAP)}…`
              : text;
        }
      }
    }

    // Title-source ladder rung 1 (§4.3 / BUG-018): renames are custom-title
    // lines APPENDED to the transcript, so on a long file the newest lives in
    // the tail — scan a bounded tail window (later in file = newer, so it
    // overrides a head hit). Observed names persist to the machine-local
    // sidecar; when neither window holds the line any more, the sidecar does.
    if (sizeBytes > HEAD_SCAN_BYTES) {
      const tailName = lastCustomTitle(
        parseLines(readTail(mainPath, TAIL_SCAN_BYTES)),
        id,
      );
      if (tailName) renameTitle = tailName;
    }
    if (renameTitle) rememberSessionName(id, renameTitle);
    const rename = renameTitle ?? readSessionNames()[id]?.name ?? null;

    // Agent files: count + fold their mtimes into lastActivity (the main
    // transcript can sit idle while a background agent works).
    const agentFiles = listAgentFiles(sessionsDir, id);
    let lastMs = mtimeMs;
    for (const a of agentFiles) {
      try {
        lastMs = Math.max(lastMs, statSync(a.jsonlPath).mtimeMs);
      } catch {
        // skip
      }
    }

    // The rest of the ladder (§4.3): rename > summary/ai-title > first
    // prompt > id — `titleSource` names which rung the display label rides.
    const titleSource: SessionTitleSource =
      rename !== null
        ? "rename"
        : title !== null
          ? "summary"
          : firstPrompt !== null
            ? "prompt"
            : "id";

    sessions.push({
      id,
      startedAt,
      lastActivity: new Date(lastMs).toISOString(),
      messageCount: countMessagesRaw(mainPath),
      agentCount: agentFiles.length,
      gitBranch,
      firstPrompt,
      title: rename ?? title,
      titleSource,
    });
  }

  sessions.sort((a, b) =>
    (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""),
  );
  return sessions;
}

// ── readSessionTree ───────────────────────────────────────────────────────────

interface AgentMeta {
  agentType: string;
  description: string | null;
  toolUseId: string | null;
  spawnDepth: number;
}

function readAgentMeta(metaPath: string): AgentMeta {
  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf8")) as Line;
    return {
      agentType: str(parsed.agentType) ?? "unknown",
      description: str(parsed.description),
      toolUseId: str(parsed.toolUseId),
      // Older sidecars omit spawnDepth — a direct child of the session.
      spawnDepth: typeof parsed.spawnDepth === "number" ? parsed.spawnDepth : 1,
    };
  } catch {
    return {
      agentType: "unknown",
      description: null,
      toolUseId: null,
      spawnDepth: 1,
    };
  }
}

/** What a transcript pass tells us about the agents it spawned + itself. */
interface TranscriptScan {
  /** tool_use id → true, for Task/Agent spawn blocks in this transcript. */
  spawnToolUseIds: Set<string>;
  /** tool_use ids with a SYNC completion (toolUseResult.status "completed",
   *  or a tool_result with no status field — older format). */
  completedToolUseIds: Set<string>;
  /** agent/task ids named in a <task-notification> with status completed. */
  notifiedDoneIds: Set<string>;
  messageCount: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  lastModel: string | null;
  firstUserPrompt: string | null;
}

const SPAWN_TOOL_NAMES = new Set(["Task", "Agent"]);

/**
 * Single tolerant pass over one transcript's parsed lines.
 * `countSidechains=false` excludes isSidechain lines from the message count
 * (older Claude Code versions interleaved subagent lines into the main file).
 */
function scanTranscript(
  lines: Iterable<Line>,
  countSidechains: boolean,
): TranscriptScan {
  const scan: TranscriptScan = {
    spawnToolUseIds: new Set(),
    completedToolUseIds: new Set(),
    notifiedDoneIds: new Set(),
    messageCount: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    lastModel: null,
    firstUserPrompt: null,
  };

  for (const line of lines) {
    const ts = str(line.timestamp);
    if (ts) {
      if (scan.firstTimestamp === null) scan.firstTimestamp = ts;
      scan.lastTimestamp = ts;
    }

    // Background-agent completion notifications arrive as queued prompts —
    // both the queue-operation line (content: string) and the attachment line
    // (attachment.prompt) carry the same <task-notification> XML.
    const notifText =
      line.type === "queue-operation"
        ? str(line.content)
        : line.type === "attachment"
          ? str((line.attachment as Line | undefined)?.prompt)
          : null;
    if (notifText && notifText.includes("<task-notification>")) {
      const status = /<status>([^<]*)<\/status>/.exec(notifText)?.[1];
      if (status === "completed") {
        const taskId = /<task-id>([^<]*)<\/task-id>/.exec(notifText)?.[1];
        const toolUseId = /<tool-use-id>([^<]*)<\/tool-use-id>/.exec(
          notifText,
        )?.[1];
        if (taskId) scan.notifiedDoneIds.add(taskId);
        if (toolUseId) scan.notifiedDoneIds.add(toolUseId);
      }
      continue;
    }

    if (line.type !== "user" && line.type !== "assistant") continue;
    if (!countSidechains && line.isSidechain === true) continue;
    scan.messageCount++;

    if (line.type === "user" && scan.firstUserPrompt === null && !line.isMeta) {
      const text = userTextOf(line);
      if (text && !isNoisePrompt(text)) scan.firstUserPrompt = text;
    }

    const model = str(messageOf(line).model);
    if (model) scan.lastModel = model;

    for (const b of blocksOf(line)) {
      if (b.type === "tool_use") {
        const id = str(b.id);
        const name = str(b.name);
        if (id && name && SPAWN_TOOL_NAMES.has(name)) {
          scan.spawnToolUseIds.add(id);
        }
      } else if (b.type === "tool_result") {
        const id = str(b.tool_use_id);
        if (!id) continue;
        // The line-level toolUseResult.status distinguishes a real completion
        // ("completed") from a background-launch ack ("async_launched"): the ack
        // is NOT a completion, so only a real result marks the spawn done.
        const tur = line.toolUseResult;
        const status =
          tur !== null && typeof tur === "object" && !Array.isArray(tur)
            ? str((tur as Line).status)
            : null;
        if (status !== "async_launched") {
          scan.completedToolUseIds.add(id);
        }
      }
    }
  }

  return scan;
}

/** Liveness decision for one agent — see module doc for the evidence order. */
function agentStatus(
  meta: AgentMeta,
  agentId: string,
  parentScans: TranscriptScan[],
  mtimeMs: number,
  now: number,
  thresholdMs: number,
): AgentStatus {
  for (const scan of parentScans) {
    if (meta.toolUseId && scan.completedToolUseIds.has(meta.toolUseId))
      return "done";
    if (
      scan.notifiedDoneIds.has(agentId) ||
      (meta.toolUseId && scan.notifiedDoneIds.has(meta.toolUseId))
    ) {
      return "done";
    }
  }
  return now - mtimeMs <= thresholdMs ? "running" : "done";
}

/**
 * Cheap existence check (id charset + transcript file present) — used by the
 * SSE stream route to 404 without parsing a potentially-huge transcript.
 */
export function sessionExists(
  projectRoot: string,
  sessionId: string,
  opts?: TranscriptOpts,
): boolean {
  if (!SESSION_ID_RE.test(sessionId)) return false;
  const sessionsDir = resolveProjectSessionsDir(projectRoot, opts);
  if (!sessionsDir) return false;
  return existsSync(join(sessionsDir, `${sessionId}.jsonl`));
}

/**
 * Build the agent tree for one session: the root node plus one node per
 * subagent, parent-linked via meta.toolUseId ↔ the spawning transcript's
 * Task/Agent tool_use block. Returns null for an unknown session.
 */
export function readSessionTree(
  projectRoot: string,
  sessionId: string,
  opts?: TranscriptOpts,
): SessionTree | null {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  const sessionsDir = resolveProjectSessionsDir(projectRoot, opts);
  if (!sessionsDir) return null;
  const mainPath = join(sessionsDir, `${sessionId}.jsonl`);
  if (!existsSync(mainPath)) return null;

  const now = opts?.now ?? Date.now();
  const thresholdMs = opts?.runningThresholdMs ?? RUNNING_THRESHOLD_MS;

  let mainMtimeMs = 0;
  try {
    mainMtimeMs = statSync(mainPath).mtimeMs;
  } catch {
    // keep 0 — status falls back to done
  }

  // One pass over the main transcript + one per agent transcript.
  const mainScan = scanTranscript(readJsonl(mainPath), false);
  const agentFiles = listAgentFiles(sessionsDir, sessionId);
  const agentData = agentFiles.map((f) => {
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(f.jsonlPath).mtimeMs;
    } catch {
      // keep 0
    }
    return {
      ...f,
      meta: readAgentMeta(f.metaPath),
      scan: scanTranscript(readJsonl(f.jsonlPath), true),
      mtimeMs,
    };
  });

  // toolUseId → spawning node id ("root" or an agent id) for parent linkage.
  const spawnerOf = new Map<string, string>();
  for (const id of mainScan.spawnToolUseIds) spawnerOf.set(id, "root");
  for (const a of agentData) {
    for (const id of a.scan.spawnToolUseIds) {
      if (!spawnerOf.has(id)) spawnerOf.set(id, a.id);
    }
  }

  const allScans = [mainScan, ...agentData.map((a) => a.scan)];
  const agents: AgentNode[] = agentData.map((a) => ({
    id: a.id,
    parentId: (a.meta.toolUseId && spawnerOf.get(a.meta.toolUseId)) || "root",
    agentType: a.meta.agentType,
    description: a.meta.description,
    toolUseId: a.meta.toolUseId,
    spawnDepth: a.meta.spawnDepth,
    status: agentStatus(a.meta, a.id, allScans, a.mtimeMs, now, thresholdMs),
    startedAt: a.scan.firstTimestamp,
    lastActivity:
      a.mtimeMs > 0 ? new Date(a.mtimeMs).toISOString() : a.scan.lastTimestamp,
    messageCount: a.scan.messageCount,
    model: a.scan.lastModel,
  }));

  // Root is "running" while anything in the session is still writing.
  const newestMs = Math.max(mainMtimeMs, ...agentData.map((a) => a.mtimeMs));
  const root: AgentNode = {
    id: "root",
    parentId: null,
    agentType: "session",
    description: mainScan.firstUserPrompt
      ? mainScan.firstUserPrompt.length > FIRST_PROMPT_CAP
        ? `${mainScan.firstUserPrompt.slice(0, FIRST_PROMPT_CAP)}…`
        : mainScan.firstUserPrompt
      : null,
    toolUseId: null,
    spawnDepth: 0,
    status: now - newestMs <= thresholdMs ? "running" : "done",
    startedAt: mainScan.firstTimestamp,
    lastActivity:
      mainMtimeMs > 0
        ? new Date(mainMtimeMs).toISOString()
        : mainScan.lastTimestamp,
    messageCount: mainScan.messageCount,
    model: mainScan.lastModel,
  };

  return { sessionId, root, agents };
}

// ── readAgentConversation ─────────────────────────────────────────────────────

function truncate(
  text: string,
  cap: number,
): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };
  return { text: `${text.slice(0, cap)}…`, truncated: true };
}

/** Compact one-line summary of a tool_use input for display. */
function toolInputSummary(input: unknown): string {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return truncate(String(input ?? ""), TOOL_SUMMARY_CAP).text;
  }
  const o = input as Line;
  const lead =
    str(o.description) ??
    str(o.command) ??
    str(o.file_path) ??
    str(o.pattern) ??
    str(o.url) ??
    str(o.prompt);
  if (lead) return truncate(lead.replace(/\s+/g, " "), TOOL_SUMMARY_CAP).text;
  try {
    return truncate(JSON.stringify(o), TOOL_SUMMARY_CAP).text;
  } catch {
    return "";
  }
}

/** Flatten a tool_result's content (string or block list) to display text. */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const b of content) {
    if (b !== null && typeof b === "object" && (b as Line).type === "text") {
      const t = str((b as Line).text);
      if (t) parts.push(t);
    }
  }
  return parts.join("\n");
}

/** Map one user/assistant line to a display turn (null → nothing to show). */
function lineToTurn(line: Line): ConversationTurn | null {
  const role = line.type === "user" ? "user" : "assistant";
  const blocks: TurnBlock[] = [];
  const content = messageOf(line).content;

  if (typeof content === "string") {
    if (content.trim()) {
      const t = truncate(content, TEXT_CAP);
      blocks.push({ kind: "text", text: t.text, truncated: t.truncated });
    }
  } else {
    for (const b of blocksOf(line)) {
      if (b.type === "text") {
        const raw = str(b.text);
        if (raw && raw.trim()) {
          const t = truncate(raw, TEXT_CAP);
          blocks.push({ kind: "text", text: t.text, truncated: t.truncated });
        }
      } else if (b.type === "thinking") {
        const raw = str(b.thinking);
        if (raw && raw.trim()) {
          const t = truncate(raw, THINKING_CAP);
          blocks.push({
            kind: "thinking",
            text: t.text,
            truncated: t.truncated,
          });
        }
      } else if (b.type === "tool_use") {
        blocks.push({
          kind: "tool_use",
          toolUseId: str(b.id) ?? "",
          name: str(b.name) ?? "tool",
          summary: toolInputSummary(b.input),
        });
      } else if (b.type === "tool_result") {
        const t = truncate(toolResultText(b.content), TOOL_RESULT_CAP);
        blocks.push({
          kind: "tool_result",
          toolUseId: str(b.tool_use_id) ?? "",
          text: t.text,
          isError: b.is_error === true,
          truncated: t.truncated,
        });
      }
    }
  }

  if (blocks.length === 0) return null;
  return {
    uuid: str(line.uuid) ?? "",
    role,
    timestamp: str(line.timestamp),
    model: role === "assistant" ? str(messageOf(line).model) : null,
    blocks,
  };
}

/**
 * Slice a chronological turn list into the requested window (tail / before /
 * all). See ReadConversationOpts for the semantics.
 */
function windowTurns(
  all: ConversationTurn[],
  opts: ReadConversationOpts,
): { turns: ConversationTurn[]; hasMore: boolean; oldestUuid: string | null } {
  if (opts.all) {
    return {
      turns: all,
      hasMore: false,
      oldestUuid: all.length > 0 ? all[0].uuid : null,
    };
  }

  const rawLimit = opts.limit;
  const limit =
    typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.floor(rawLimit)
      : DEFAULT_CONVERSATION_LIMIT;

  // Exclusive upper bound of the window. Tail → end of the array; before →
  // the cursor turn's index. An unknown cursor → empty window (dead cursor).
  let end = all.length;
  if (opts.before) {
    const idx = all.findIndex((t) => t.uuid === opts.before);
    if (idx < 0) return { turns: [], hasMore: false, oldestUuid: null };
    end = idx;
  }

  const start = Math.max(0, end - limit);
  const turns = all.slice(start, end);
  return {
    turns,
    hasMore: start > 0,
    oldestUuid: turns.length > 0 ? turns[0].uuid : null,
  };
}

/**
 * A WINDOW of one agent's display-ready turns — `agentId` "root" reads the main
 * transcript (sidechain lines excluded there: old-format interleaving). Returns
 * null for an unknown session/agent.
 *
 * Complexity: a single read + parse of the agent's file yields the full
 * chronological turn list; the window is a slice of that. So each request is
 * O(file bytes) — a 74MB / 5867-msg main transcript is read + parsed once per
 * request (no incremental index). Cheap enough for interactive paging; a
 * byte-offset index would be the next step only if that read ever hurts.
 */
export function readAgentConversation(
  projectRoot: string,
  sessionId: string,
  agentId: string,
  opts?: ReadConversationOpts,
): AgentConversation | null {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  const sessionsDir = resolveProjectSessionsDir(projectRoot, opts);
  if (!sessionsDir) return null;

  let filePath: string;
  let agentType = "session";
  let description: string | null = null;

  if (agentId === "root") {
    filePath = join(sessionsDir, `${sessionId}.jsonl`);
  } else {
    if (!AGENT_ID_RE.test(agentId)) return null;
    const dir = subagentsDirOf(sessionsDir, sessionId);
    filePath = join(dir, `agent-${agentId}.jsonl`);
    // Belt-and-braces path confinement (the regexes above already forbid
    // separators/dots — mirror resolveVerifyPath's defence in depth).
    const safeBase = resolve(dir) + sep;
    if (!resolve(filePath).startsWith(safeBase)) return null;
    const meta = readAgentMeta(join(dir, `agent-${agentId}.meta.json`));
    agentType = meta.agentType;
    description = meta.description;
  }
  if (!existsSync(filePath)) return null;

  // Full chronological turn list (model = last assistant model across ALL turns,
  // not just the returned window), then slice the requested window.
  const all: ConversationTurn[] = [];
  let model: string | null = null;
  for (const line of readJsonl(filePath)) {
    if (line.type !== "user" && line.type !== "assistant") continue;
    if (agentId === "root" && line.isSidechain === true) continue;
    const turn = lineToTurn(line);
    if (!turn) continue;
    if (turn.model) model = turn.model;
    all.push(turn);
  }

  const win = windowTurns(all, opts ?? {});
  return {
    sessionId,
    agentId,
    agentType,
    description,
    model,
    turns: win.turns,
    total: all.length,
    hasMore: win.hasMore,
    oldestUuid: win.oldestUuid,
  };
}

// ── readToolResult ─────────────────────────────────────────────────────────────

/** tool_use ids: Claude writes `toolu_<token>`; accept a safe id charset only. */
const TOOL_USE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Full, UNTRUNCATED tool_result for one tool call, plus the tool_use name/input.
 * Scans every transcript of the session (root + subagents) — a tool call and its
 * result share a transcript, but the id may live in any of them. Root reads skip
 * sidechain lines, matching the conversation view. Returns null (→ 404) when the
 * id names neither a tool_use nor a tool_result.
 */
export function readToolResult(
  projectRoot: string,
  sessionId: string,
  toolUseId: string,
  opts?: TranscriptOpts,
): ToolResultDetail | null {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  if (!TOOL_USE_ID_RE.test(toolUseId)) return null;
  const sessionsDir = resolveProjectSessionsDir(projectRoot, opts);
  if (!sessionsDir) return null;
  if (!existsSync(join(sessionsDir, `${sessionId}.jsonl`))) return null;

  let name: string | null = null;
  let input: unknown = null;
  let foundUse = false;
  let text = "";
  let isError = false;
  let foundResult = false;

  for (const f of sessionTranscriptFiles(sessionsDir, sessionId)) {
    if (foundUse && foundResult) break;
    for (const line of readJsonl(f.filePath)) {
      if (line.type !== "user" && line.type !== "assistant") continue;
      if (f.isRoot && line.isSidechain === true) continue;
      for (const b of blocksOf(line)) {
        if (!foundUse && b.type === "tool_use" && str(b.id) === toolUseId) {
          name = str(b.name);
          input = b.input ?? null;
          foundUse = true;
        } else if (
          !foundResult &&
          b.type === "tool_result" &&
          str(b.tool_use_id) === toolUseId
        ) {
          text = toolResultText(b.content);
          isError = b.is_error === true;
          foundResult = true;
        }
      }
      if (foundUse && foundResult) break;
    }
  }

  if (!foundUse && !foundResult) return null;
  return {
    toolUseId,
    name: name ?? "tool",
    input,
    result: { text, isError, truncated: false },
  };
}

// ── searchSession ──────────────────────────────────────────────────────────────

type SearchableBlock = {
  blockType: SearchMatch["blockType"];
  text: string;
};

/** Whitespace-collapsed searchable text per block of a line (full, untruncated
 *  for text/thinking/tool_result; tool_use uses its display summary). */
function searchableBlocks(line: Line): SearchableBlock[] {
  const out: SearchableBlock[] = [];
  const push = (blockType: SearchMatch["blockType"], raw: string | null) => {
    if (!raw) return;
    const text = raw.replace(/\s+/g, " ").trim();
    if (text) out.push({ blockType, text });
  };

  const content = messageOf(line).content;
  if (typeof content === "string") {
    push("text", content);
    return out;
  }
  for (const b of blocksOf(line)) {
    if (b.type === "text") push("text", str(b.text));
    else if (b.type === "thinking") push("thinking", str(b.thinking));
    else if (b.type === "tool_use") push("tool_use", toolInputSummary(b.input));
    else if (b.type === "tool_result")
      push("tool_result", toolResultText(b.content));
  }
  return out;
}

/** ~120-char snippet centred on a hit; ellipses mark trimmed edges. */
function makeSnippet(text: string, hit: number, qLen: number): string {
  const start = Math.max(0, hit - SNIPPET_RADIUS);
  const end = Math.min(text.length, hit + qLen + SNIPPET_RADIUS);
  const core = text.slice(start, end);
  return `${start > 0 ? "…" : ""}${core}${end < text.length ? "…" : ""}`;
}

/**
 * Case-insensitive substring search across every text / thinking /
 * tool_use-summary / tool_result block of a session's agents (root + subagents,
 * root-first + chronological). Root reads skip sidechain lines, matching the
 * conversation view. Capped at SEARCH_MATCH_CAP matches (`capped` flags the cut).
 * An empty/whitespace query returns no matches. Returns null for an unknown
 * session (→ 404).
 */
export function searchSession(
  projectRoot: string,
  sessionId: string,
  q: string,
  opts?: TranscriptOpts,
): SessionSearchResult | null {
  if (!SESSION_ID_RE.test(sessionId)) return null;
  const sessionsDir = resolveProjectSessionsDir(projectRoot, opts);
  if (!sessionsDir) return null;
  if (!existsSync(join(sessionsDir, `${sessionId}.jsonl`))) return null;

  const needle = q.trim().toLowerCase();
  if (!needle) return { q, matches: [], capped: false };

  const matches: SearchMatch[] = [];
  let capped = false;

  for (const f of sessionTranscriptFiles(sessionsDir, sessionId)) {
    if (capped) break;
    for (const line of readJsonl(f.filePath)) {
      if (capped) break;
      if (line.type !== "user" && line.type !== "assistant") continue;
      if (f.isRoot && line.isSidechain === true) continue;
      const role = line.type === "user" ? "user" : "assistant";
      const uuid = str(line.uuid) ?? "";
      for (const sb of searchableBlocks(line)) {
        const hit = sb.text.toLowerCase().indexOf(needle);
        if (hit < 0) continue;
        matches.push({
          agentId: f.agentId,
          agentLabel: f.label,
          turnUuid: uuid,
          role,
          blockType: sb.blockType,
          snippet: makeSnippet(sb.text, hit, needle.length),
        });
        if (matches.length >= SEARCH_MATCH_CAP) {
          capped = true;
          break;
        }
      }
    }
  }

  return { q, matches, capped };
}
