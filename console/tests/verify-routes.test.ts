// @vitest-environment node
/**
 * verify-routes.test.ts — Route-level tests for the M5 fix (GET verify
 * endpoints must be side-effect-free) and the M4 fix (PUT persists the
 * reconciled + patched shape, guarded by an optimistic-concurrency check).
 *
 * Companion to tests/verify.test.ts (io-layer unit tests) and
 * tests/server.test.ts (write-guard security tests) — this file exercises
 * the verify-routes.ts plugin directly via fastify.inject with a
 * pass-through writeGuard (security is covered elsewhere).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

let tempRoot: string;
let tempVerifyDir: string;

beforeAll(() => {
  tempRoot = join(tmpdir(), `ccmaf-verify-routes-test-${Date.now()}`);
  tempVerifyDir = join(tempRoot, ".claude", "console", "verify");
  mkdirSync(tempVerifyDir, { recursive: true });
  mkdirSync(join(tempRoot, ".claude"), { recursive: true });
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// Must be registered before any import that depends on project-root.
vi.mock("../src/server/project-root.js", () => {
  return {
    findProjectRoot: (_: string) => tempRoot,
    getProjectRoot: () => tempRoot,
    dotClaudePath: (...segments: string[]) =>
      [tempRoot, ".claude", ...segments].join("/"),
  };
});

const verifyRoutes = (await import("../src/server/routes/verify-routes.js")).default;
const { writeVerifyFile } = await import("../src/server/verify/io.js");
import type { VerifyFile } from "../src/server/verify/schema.js";

function passThroughGuard(
  _req: FastifyRequest,
  _reply: FastifyReply,
  done: () => void
): void {
  done();
}

async function buildTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(verifyRoutes, { writeGuard: passThroughGuard });
  await app.ready();
  return app;
}

function makeItem(overrides: Partial<VerifyFile["items"][number]> = {}) {
  return {
    id: "item-1",
    kind: "test-plan-item",
    title: "A use case",
    verdict: "fail" as const,
    severity: "P1" as const,
    bugId: "BUG-070",
    round: 1,
    ...overrides,
  };
}

describe("GET /api/verify and /api/verify/:task — side-effect-free (M5)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // BUG-070 is Done in TASKS.md, so the retest-loop reconcile WOULD flip
    // item-1 (which carries bugId BUG-070, still failing) back to pending —
    // exactly the condition that used to trigger a write on the read path.
    writeFileSync(
      join(tempRoot, ".claude", "TASKS.md"),
      ["# Task Board", "", "## Bug-Fix Lane", "", "### Done", "", "#### [BUG-070] Fixed bug", ""].join(
        "\n"
      ),
      "utf8"
    );
    const file: VerifyFile = {
      schemaVersion: 1,
      task: "TASK-610",
      status: "processing-fixes",
      items: [makeItem()],
    };
    writeVerifyFile(file);
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/verify performs zero disk writes even though a reconcile applies", async () => {
    const filePath = join(tempVerifyDir, "TASK-610.json");
    const mtimeBefore = statSync(filePath).mtimeMs;

    const res = await app.inject({ method: "GET", url: "/api/verify" });
    expect(res.statusCode).toBe(200);
    const refs = res.json<{ task: string; counts: Record<string, number> }[]>();
    const ref = refs.find((r) => r.task === "TASK-610");
    expect(ref).toBeDefined();
    // The reconciled view (pending) is what the caller sees...
    expect(ref!.counts["pending"]).toBe(1);
    // ...but the file on disk must not have moved.
    expect(statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });

  it("GET /api/verify/:task performs zero disk writes even though a reconcile applies", async () => {
    const filePath = join(tempVerifyDir, "TASK-610.json");
    const mtimeBefore = statSync(filePath).mtimeMs;

    const res = await app.inject({ method: "GET", url: "/api/verify/TASK-610" });
    expect(res.statusCode).toBe(200);
    const file = res.json<VerifyFile>();
    expect(file.items[0].verdict).toBe("pending");
    expect(statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });

  it("PUT persists the reconciled + patched shape (reconcile still happens on the write path)", async () => {
    const filePath = join(tempVerifyDir, "TASK-610.json");
    const res = await app.inject({
      method: "PUT",
      url: "/api/verify/TASK-610",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([{ id: "item-1", verdict: "pass" }]),
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<VerifyFile>();
    expect(updated.items[0].verdict).toBe("pass");

    const onDisk = JSON.parse(readFileSync(filePath, "utf8")) as VerifyFile;
    // The persisted file reflects the retest-loop reconcile (bugId cleared by
    // the pass, round bumped) — it was NOT stuck at the pre-reconcile shape.
    expect(onDisk.items[0].verdict).toBe("pass");
    expect(onDisk.items[0].bugId).toBeNull();
  });
});
