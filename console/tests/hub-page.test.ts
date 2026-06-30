/**
 * hub-page.test.ts — Hub flyout window markup (TASK-043)
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { renderHubPage } from "../src/server/hub/hub-page.js";

const TOKEN = "feedfacecafe";
const html = renderHubPage(TOKEN);

describe("renderHubPage", () => {
  it("is a complete HTML document titled Console Hub", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Console Hub</title>");
    expect(html).toContain("</html>");
  });

  it("embeds the write token", () => {
    expect(html).toContain("'" + TOKEN + "'");
  });

  it("polls state + wires the lifecycle actions", () => {
    expect(html).toContain("/api/hub/state");
    expect(html).toContain("/api/hub/open");
    expect(html).toContain("/api/hub/end");
    expect(html).toContain("/api/hub/start");
  });

  it("edits settings inline via /api/settings", () => {
    expect(html).toContain("/api/settings");
    expect(html).toContain('data-mode="app"');
    expect(html).toContain('id="tabbed"');
    expect(html).toContain('id="autoopen"');
  });

  it("has a Quit Hub button wired to /api/hub/quit", () => {
    expect(html).toContain("Quit Hub");
    expect(html).toContain("/api/hub/quit");
  });

  it("self-heals to another console when its host disappears", () => {
    expect(html).toContain("location.href");
    expect(html).toContain("/hub");
  });

  it("inline JS uses concatenation only (no leaked interpolation)", () => {
    expect(html).not.toContain("${");
  });
});
