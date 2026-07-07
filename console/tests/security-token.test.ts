// @vitest-environment node
/**
 * security-token.test.ts — isValidToken with a NON-HEX CONSOLE_TOKEN.
 *
 * LAUNCH_TOKEN is captured at module load from CONSOLE_TOKEN, so this must run in
 * its own file (fresh module graph) with the env set BEFORE the import. It guards
 * the foot-gun the old hex-decode had: a non-hex operator token made every
 * equal-length non-hex header decode to the SAME empty buffer and compare EQUAL
 * (auth bypass). The utf8 compare keeps every byte significant.
 */

import { describe, it, expect } from "vitest";

const NON_HEX_TOKEN = "ZZ".repeat(16); // 32 chars, no valid hex digit

const saved = process.env.CONSOLE_TOKEN;
process.env.CONSOLE_TOKEN = NON_HEX_TOKEN;
const { isValidToken, LAUNCH_TOKEN } =
  await import("../src/server/security.js");
// LAUNCH_TOKEN is already captured — restore env so sibling test files (which may
// share this worker) load with their own CONSOLE_TOKEN state.
if (saved === undefined) delete process.env.CONSOLE_TOKEN;
else process.env.CONSOLE_TOKEN = saved;

describe("isValidToken — non-hex CONSOLE_TOKEN foot-gun", () => {
  it("captured the non-hex token verbatim", () => {
    expect(LAUNCH_TOKEN).toBe(NON_HEX_TOKEN);
  });

  it("accepts the exact non-hex token", () => {
    expect(isValidToken(NON_HEX_TOKEN)).toBe(true);
  });

  it("rejects a DIFFERENT same-length non-hex value (no empty-buffer bypass)", () => {
    // Old impl: Buffer.from("ZZ…","hex") === Buffer.from("YY…","hex") === ∅ → true.
    expect(isValidToken("YY".repeat(16))).toBe(false);
  });

  it("rejects a value one char short/long", () => {
    expect(isValidToken(`${NON_HEX_TOKEN}Z`)).toBe(false);
    expect(isValidToken(NON_HEX_TOKEN.slice(0, -1))).toBe(false);
  });

  it("rejects empty and undefined", () => {
    expect(isValidToken("")).toBe(false);
    expect(isValidToken(undefined)).toBe(false);
  });
});
