---
description: Show or switch the watcher mode (which codex advisor augments review + verify)
---

Show or switch the framework **mode** — which model family fills the advisory review + verify
roles ("watcher mode", TASK-132). Modes live in the consumer-owned registry
`advisors.toml` (project `.claude/` override, else `~/.claude/`) under `[modes]`; this command reads/sets the `active` pointer, validating
fail-closed before it writes. See `${CLAUDE_PLUGIN_ROOT}/scripts/PROTOCOL.md` "Watcher mode" for the
model + the four load-bearing rules (augment-never-replace · advisory-roles-only · evidence-
verifier-fail-closed · client-attested-degrade-loudly).

**First use:** ensure the live registry exists —
`bash -c '. "${CLAUDE_PLUGIN_ROOT}/scripts/advisors-lib.sh"; advisors_ensure_registry'`
creates it from the plugin's shipped template (project `.claude/advisors.toml` if present, else
`~/.claude/advisors.toml`) and prints the resolved path.

`$ARGUMENTS` = an optional mode name (`normal`, `watcher-low`, `watcher-medium`, `watcher-high`, or
any `[modes.<name>]` you have defined). No argument → SHOW.

## No argument — SHOW the current mode
1. `bash -c '. "${CLAUDE_PLUGIN_ROOT}/scripts/advisors-lib.sh"; mode_active'` → the active mode.
2. `bash -c '. "${CLAUDE_PLUGIN_ROOT}/scripts/advisors-lib.sh"; registry_modes'` → the defined modes
   (plus the always-valid implicit `normal`).
3. For the active mode, report what it maps. For `normal`: "every role is a Claude subagent —
   nothing added." For a `watcher-*` mode, read `[modes.<active>].reviewer` / `.verifier` and each
   named advisor's `model` (via `registry_get`), then say e.g.:
   > **mode: watcher-medium** — reviewer = `sol` (gpt-5.6-sol) · verifier = `terra` (gpt-5.6-terra),
   > AUGMENTing the Claude reviewer/verifier (a client-attested cross-check, not the gate).
4. If a watcher tier is active, remind the user it spends codex plan quota — one caged consult per
   watched role, per `/review` (and per `/build` review step).

## With a mode name — SWITCH
1. Normalise the requested name (trim, lowercase).
2. **VALIDATE fail-closed BEFORE writing:**
   `bash -c '. "${CLAUDE_PLUGIN_ROOT}/scripts/advisors-lib.sh"; mode_validate "<name>"'`.
   - exit 0 → valid, continue.
   - exit 1 → unknown mode: STOP, show the `registry_modes` list + `normal`, do not switch.
   - exit 3 → a slot names an unknown or non-codex advisor (config error): STOP, relay the stderr
     reason, do not switch. (Fix the `[modes.<name>]` slot or the advisor row first.)
3. **If switching to a watcher tier** (any codex seat), surface the A5 gate ONCE before you commit
   the switch: real code diffs get staged to codex on each review, so the ChatGPT training opt-out
   should be confirmed — check the A5 marker, `.claude/.codex-training-optout-confirmed` in the
   project root, else the same path under `~/.claude/` (resolved by advisors-lib; the
   `codex-preflight.sh` A5 check). If absent, tell the user and let them decide to proceed anyway
   or set it first; do not create the marker for them.
4. On valid: set the mode by editing the SINGLE `active = "..."` line in `advisors.toml` (project `.claude/` override, else `~/.claude/`)
   (the LIVE registry — NEVER the shipped template `advisors.template.toml`). Use Edit; change only
   that line. **Disclosure — user-level registry is machine-global:** if the project has no
   `.claude/advisors.toml`, the live registry is `~/.claude/advisors.toml`, which governs EVERY
   repo on this machine without its own registry — a watcher switch there applies machine-wide.
   Say so and get the user's explicit OK before writing in that case.
5. Confirm the new mapping (as in SHOW) and note: it takes effect on the **next `/review`** (and
   `/build`'s review step) — read fresh each time, no restart. `normal` = the safe default (all-
   Claude, zero codex spend); a watcher tier is a spend decision. (Watcher modes only take effect
   where the CCMAF framework's `/review`/`/build` are present — in a standalone plugin install you
   can define and switch modes, but nothing consumes them yet.)

## Guards
- Edit ONLY the live `advisors.toml` (project `.claude/` override, else `~/.claude/`); the template is framework-owned and overwritten on
  update.
- Watcher modes touch ONLY the reviewer + verifier (advisory roles). A codex seat can never be a
  doer — the resolver has no doer role to route to (PROTOCOL.md "Watcher mode"). Do not attempt to
  add a `developer`/`tester` slot to a mode; it is not honoured and is a category error.
- Never present an unverified watcher opinion as a review verdict — `/review` verifies it fail-
  closed and the Claude reviewer/verifier remains the gate.
