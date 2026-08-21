# Attestation — proving a dispatch ran on the model it claims

Opt-in, off by default. Generalises the `/fable` fresh-spawn + transcript
verification mechanism (`plugins/advisors/commands/fable.md` Steps 3-4,
`plugins/advisors/fable/verify-turn.sh`) into a snippet any `Agent()`
dispatch can include. `/ccmaf:build` reads `attest: true` from a task/wave's
plan header and includes this brief when set.

## Why: what it catches

A subagent's own self-report of which model it ran on proves nothing — a
harness could silently reroute a dispatch to a cheaper/different model and
the transcript's prose would never say so. This matters most for a tiering
experiment where a silent reroute would corrupt the comparison. Ground
truth is the **per-message transcript field** `.message.model`, not the
model's self-report (proves only the start of a turn) and not a text grep
over the response (false-fails when it merely *discusses* model names).

## The brief block (paste into a dispatch)

```
Before your final message, write the exact token `ATTEST-<nonce>` on its
own line (nonce supplied below — do not paraphrase or omit it).
```

Generate `<nonce>` fresh per dispatch (e.g. a short random hex string) and
substitute it into the block above. Do not resume a prior subagent's
session for an attested turn — resuming can silently drop the effective
model; every attested turn is a fresh spawn.

## Verifying after the dispatch returns

```bash
glob="$HOME/.claude/projects/*/*/subagents/*.jsonl"
transcript="$(grep -lF -- "ATTEST-<nonce>" $glob 2>/dev/null | xargs -r ls -t | head -1)"
[ -n "$transcript" ] || { echo "FAIL: no transcript found for nonce"; exit 1; }
jq -r 'select(.type=="assistant") | .message.model // empty' "$transcript" | sort -u
```

PASS iff exactly one model appears and it matches the model the dispatch
declared. Any other model, or more than one distinct model, is a FAIL —
report it as a finding rather than silently trusting the dispatch.

## When to use it

- A tiering-experiment run comparing behaviour/cost across declared model
  tiers, where a silent reroute would invalidate the comparison.
- Ruling out silent model substitution when a dispatch's output looks
  suspiciously off-profile for its declared model.
- NOT for routine task dispatch — the nonce + verification step costs a
  round-trip and a `jq` dependency; reserve it for when model identity
  itself is the thing under test.

## Limits

This is **client-side attestation** — it proves what the harness's own
transcript recorded, not a cryptographic guarantee independent of the
harness; a harness that falsified its own transcript would defeat it. It
also can't attest a turn that produced no transcript (e.g. a crashed
spawn) — treat a missing transcript as a FAIL, not a gap to ignore.
