#!/usr/bin/env node
// ccmaf-console — thin verb dispatcher over the built artefacts.
// The package ships pre-built (dist/ + dist-server/ via `prepack`), so there is
// no build logic here — each verb loads the already-compiled entrypoint.
//
//   ccmaf-console start|stop|open|restart [--root <path>]  → per-project lifecycle (launcher)
//   ccmaf-console hub                                       → the always-on machine Hub
//   ccmaf-console serve                                     → foreground per-project server (debug)
//   ccmaf-console version                                   → package version

const verb = (process.argv[2] || "help").toLowerCase();

switch (verb) {
  case "start":
  case "stop":
  case "open":
  case "restart": {
    // launcher.main() reads process.argv[2] as the verb (matched raw), so normalise it
    // first — otherwise `ccmaf-console START` passes this switch but the launcher rejects
    // the un-lowercased "START" and prints its own usage.
    process.argv[2] = verb;
    const { main } = await import("../dist-server/hub/launcher.js");
    process.exit(await main(process.argv));
    break;
  }
  case "hub":
    // hub-main.js calls runHub() at module top-level (no invokedDirectly guard) → importing runs it.
    await import("../dist-server/hub/hub-main.js");
    break;
  case "serve":
    // main.js calls startServer() at module top-level → importing runs the foreground server (debug).
    await import("../dist-server/main.js");
    break;
  case "version":
  case "--version":
  case "-v": {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    console.log(require("../package.json").version);
    break;
  }
  default:
    console.error(
      "usage: ccmaf-console <start|stop|open|restart|hub|serve|version> [--root <path>]",
    );
    process.exit(verb === "help" ? 0 : 2);
}
