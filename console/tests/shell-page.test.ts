/**
 * shell-page.test.ts — tabbed-shell pure helpers (TASK-041)
 *
 * The shell UI is interactive (iframes live consoles) and is verified by opening
 * the chromeless window; here we cover the pure pieces: the secret-stripping
 * registry projection and the self-contained page markup.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { toShellConsoles, renderShellPage } from "../src/server/shell/shell-page.js";
import type { RegistryEntry } from "../src/server/hub/registry.js";

function entry(port: number, project: string): RegistryEntry {
  return {
    schemaVersion: 1,
    project,
    rootPath: `F:/p/${project}`,
    port,
    pid: 42,
    version: "0.1.0",
    startedAt: "2026-06-29T00:00:00Z",
    shutdownToken: "super-secret-token",
    autoStart: true,
  };
}

describe("toShellConsoles", () => {
  it("projects only project/port/rootPath (NO shutdownToken or pid)", () => {
    const out = toShellConsoles([entry(6120, "alpha")]);
    expect(out).toEqual([
      { project: "alpha", port: 6120, rootPath: "F:/p/alpha" },
    ]);
    // The secret must never reach the browser.
    expect(JSON.stringify(out)).not.toContain("super-secret-token");
    expect(out[0]).not.toHaveProperty("shutdownToken");
    expect(out[0]).not.toHaveProperty("pid");
  });

  it("sorts by port so tab order is stable", () => {
    const out = toShellConsoles([entry(6174, "c"), entry(6120, "a"), entry(6133, "b")]);
    expect(out.map((c) => c.port)).toEqual([6120, 6133, 6174]);
  });

  it("empty registry → empty list", () => {
    expect(toShellConsoles([])).toEqual([]);
  });
});

describe("renderShellPage", () => {
  const html = renderShellPage();

  it("is a complete HTML document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("polls the registry endpoint and renders a tablist", () => {
    expect(html).toContain("/api/registry");
    expect(html).toContain('role="tablist"');
    expect(html).toContain("setInterval");
  });

  it("iframes consoles over loopback", () => {
    expect(html).toContain("http://127.0.0.1:");
    expect(html).toContain("iframe");
  });

  it("self-heals to another console when its host port disappears", () => {
    // The redirect-to-another-/shell branch must be present.
    expect(html).toContain("location.href");
    expect(html).toContain("/shell");
  });

  it("contains no template-literal interpolation that would have leaked from the TS string", () => {
    // The inline JS must use string concatenation, never `${...}` — otherwise it
    // would have been interpolated by THIS module's own template literal.
    expect(html).not.toContain("${");
  });
});
