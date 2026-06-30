/**
 * hub-main.ts — entry point for the consolidated tray Hub (TASK-039).
 * Run: `node dist-server/hub/hub-main.js` (npm `hub`).
 */

import { runHub } from "./hub.js";

runHub().catch((err: unknown) => {
  console.error("[hub] fatal:", err);
  process.exit(1);
});
