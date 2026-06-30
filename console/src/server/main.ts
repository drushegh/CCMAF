/**
 * main.ts — Entry point for the Console server process.
 *
 * Run via: node dist-server/main.js  (after tsc -p tsconfig.server.json)
 * Or via:  npm run serve             (convenience script in package.json)
 */

import { startServer } from "./server.js";

startServer().catch((err: unknown) => {
  console.error("[console] Fatal error during startup:", err);
  process.exit(1);
});
