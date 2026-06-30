/**
 * Read-side API client for the Console server.
 *
 * The web app (SPA) talks to the server ONLY over the HTTP contract
 * (contract:console-http-api) — it never imports server code. These helpers
 * are the single place that knows the read-endpoint shapes; pages consume the
 * typed results, not raw fetch.
 *
 * Types mirror contract:console-http-api in .claude/ECOSYSTEM.md. Keep them in
 * sync with that contract — it is the source of truth.
 */

export type Lane = "feature" | "bug";

export interface TaskItem {
  id: string;
  title: string;
  status: string;
  lane: Lane;
  /** Archived tasks are hidden by default in list/board views (filter toggle). */
  archived: boolean;
}

export interface TaskBoardColumn {
  status: string;
  lane: Lane;
  items: TaskItem[];
}

export interface TaskBoard {
  columns: TaskBoardColumn[];
}

export interface ContractSummary {
  id: string;
  status: "draft" | "stable";
  title: string;
}

export interface DecisionEntry {
  id: string;
  date?: string;
  status?: string;
  title: string;
  body?: string;
}

export interface SpecRef {
  name: string;
}

export interface SpecDoc {
  name: string;
  markdown: string;
}

export interface ReadmeDoc {
  exists: boolean;
  markdown: string;
}

/** Error thrown when an API read fails; carries the HTTP status when available. */
export class ApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Fetch JSON from a same-origin read endpoint. Read endpoints take no token
 * (contract:console-http-api — only writes require the per-launch token).
 */
async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError(
      `Could not reach the Console server (${path}). Is it running?`,
    );
  }
  if (!res.ok) {
    throw new ApiError(
      `Request to ${path} failed with ${res.status} ${res.statusText}`,
      res.status,
    );
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(`Malformed JSON from ${path}`, res.status);
  }
}

export function fetchTasks(): Promise<TaskBoard> {
  return getJson<TaskBoard>("/api/tasks");
}

export function fetchContracts(): Promise<ContractSummary[]> {
  return getJson<ContractSummary[]>("/api/contracts");
}

export function fetchDecisions(): Promise<DecisionEntry[]> {
  return getJson<DecisionEntry[]>("/api/decisions");
}

export function fetchSpecs(): Promise<SpecRef[]> {
  return getJson<SpecRef[]>("/api/specs");
}

export function fetchSpec(name: string): Promise<SpecDoc> {
  return getJson<SpecDoc>(`/api/specs/${encodeURIComponent(name)}`);
}

export function fetchReadme(): Promise<ReadmeDoc> {
  return getJson<ReadmeDoc>("/api/readme");
}

/**
 * URL for a repo-root-relative image asset the README references (BUG-015) —
 * served by the confined, images-only `/api/readme/asset` endpoint (e.g. the
 * GitHub `.github/assets/*` idiom).
 */
export function readmeAssetUrl(path: string): string {
  return `/api/readme/asset?path=${encodeURIComponent(path)}`;
}
