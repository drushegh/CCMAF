---
description: Generate a raster image via codex's built-in image_gen (ChatGPT sub, zero metered spend)
---

Generate a raster image with codex's built-in `image_gen` tool, driven through the same
ChatGPT-subscription codex provider as `/sol` / `/terra` / `/luna` — **defaulting to Terra**,
with an override. This is a **capability bridge**: Claude can't generate raster art, codex can,
so `/image` delegates the *asset* while the framework keeps the workflow. Runs on the ChatGPT
**subscription** built-in tool — **no `OPENAI_API_KEY`, zero metered spend**. The image is
**AI-generated** (built-in `image_gen`), pinned to a codex model for provenance.

`$ARGUMENTS` = `[advisor] <brief>` — the image description, optionally prefixed with a model
override. If empty, ask the user what to generate before proceeding.

**This is a SEPARATE surface from the advisory `/sol` / `/terra` / `/luna` runner and must stay
separate** (the "Two codex surfaces" rule — the advisory surface is read-only-caged; image gen needs workspace-write, so it gets its own runner, never the advisory one): image gen needs
the REAL `CODEX_HOME` (the imagegen skill lives there), `-s workspace-write`, and a long
backgrounded run — the opposite of the read-only, text-only, empty-world advisory driver.

## Capabilities & tips (read before writing the brief)

- **It renders TEXT, LABELS, and full DIAGRAMS well.** This is OpenAI's `gpt-image` (image2) —
  the same model ChatGPT uses. Ask for a labeled infographic, a titled diagram, a flowchart with
  captions — NOT just atmospheric art. Give each label EXACTLY as you want it spelled ("label,
  EXACTLY: FOO"); it spells short labels reliably, even ~15 of them in one poster. **Do not assume
  it can't do text** — that assumption is false and has cost real rework.
- **Aspect ratio goes in the brief** (there is no size flag). Say "a wide 16:9 banner" or "a
  square diagram" and orient the subject to match — a shield row tends square, a pipeline tends
  wide. Regenerate if the ratio comes out wrong.
- **A compressed `.webp` is emitted automatically** next to the PNG (Pillow-guarded; opt out with
  `CLAUDE_IMAGE_NO_WEBP=1`). Use the webp for READMEs/docs (KB, not the multi-MB PNG master).
- **For a cohesive SET** (several images that must read as one system), reuse ONE locked style
  prefix verbatim across every brief and change only the SUBJECT line; regenerate any outlier.

## Step 1 — Parse the model override (default Terra; codex-only)
- Split the FIRST whitespace token of `$ARGUMENTS`:
  - if it is exactly **`terra`**, **`sol`**, or **`luna`** → that is the advisor; the REST is the brief.
  - otherwise → advisor = **`terra`** (default) and the WHOLE `$ARGUMENTS` is the brief.
- **Reject** `fable` (or any non-codex / unknown id) that was given AS an explicit override — the
  built-in `image_gen` tool is codex-only; Fable is a Claude text advisor with no image surface.
  Stop and tell the user (don't silently fall back). A bare brief that merely *starts* with an
  unrelated word is NOT an override — only the three codex ids trigger the override branch.
- If the brief is empty after removing an override token, ask the user for the brief.

## Step 2 — Preflight + the training-privacy gate (A5)
- Ensure the live registry exists (first use):
  `bash -c '. "${CLAUDE_PLUGIN_ROOT}/scripts/advisors-lib.sh"; advisors_ensure_registry'`
  creates it from the plugin's shipped template — project `.claude/advisors.toml` if present,
  else `~/.claude/advisors.toml` — and prints the resolved path. (The image runner
  auto-ensures it too; this step just makes the location visible.)
- Run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/codex-preflight.sh"` (same A3/A4/A7 checks the advisors use;
  the image runner also runs it). Fail loud — never silently downgrade.
- **A5:** these prompts go to ChatGPT (may be used for training unless the account opted out — the
  gate `codex-preflight.sh` warns on). Image briefs are scene descriptions (low-sensitivity), but
  **do NOT stage repo internals / secrets into a brief**, and surface the gate before running.

## Step 3 — Choose the slug + output dir
- Derive a short kebab **`<slug>`** from the brief (e.g. `mountain-sunset-hero`).
- **Output dir** defaults to **`docs/images/`** (created if absent) — keep source masters there.
  If the user named a target directory/path in the brief, honour it. `workspace-write` is scoped
  to this dir, so the model can only write there.

## Step 4 — Stage the brief
Write the brief text (Step 1's remainder) to `_advisors/.imageruns/<slug>/brief.txt`. Ensure
`_advisors/` is git-ignored: if inside a git repo and it is not, append `_advisors/` to the
repo's **committed** `.gitignore` (idempotent — check first; create `.gitignore` if the repo
has none). Never commit `_advisors/` contents. **If the image will sit
UNDER text** (a hero/banner/header), include the **copy-zone tonality** in the brief — name where
the text sits and pin that region as the darkest part of the frame — or overlaid text legibility
is a coin-flip (the runner's prompt nudges this, but the brief is where it belongs).

## Step 5 — Run (FRESH, BACKGROUND)
`bash "${CLAUDE_PLUGIN_ROOT}/scripts/codex-image-run.sh" <advisor> docs/images <slug> _advisors/.imageruns/<slug>/brief.txt`
via your Bash tool with **`run_in_background: true`** — generation takes ~1.5–3 min, past the
Bash tool's 600s foreground cap (same reason `/sol` backgrounds). The runner has its own hard
`timeout` and a tree-scoped straggler reap. Never `codex exec resume`.

## Step 6 — Report (fail-closed)
When it finishes, read `_advisors/.imageruns/<slug>/status`:
- **`OK <path>`** → report the saved image path, and **disclose provenance**: AI-generated by the
  pinned model (e.g. `gpt-5.6-terra`) via the ChatGPT-sub built-in `image_gen` tool, zero metered
  spend. If a zero-dependency inline asset is needed (a `file://`-runnable pack), use the emitted
  `.webp` sibling (the runner resizes to ≤1600px wide, WebP quality ~82 — ~30 KB for a 1920×1080
  hero vs the multi-MB PNG master) and embed it as a base64 `data:` URI.
- **`TIMEOUT` / `ERROR` / `UNAVAILABLE`** → report the failure verbatim and point at
  `_advisors/.imageruns/<slug>/{err.txt,last.txt,preflight.txt}`. Do NOT claim an image exists.
- **Legibility (if art-under-text):** don't call it done because it looks good — measure the real
  rendered contrast behind each text element: sample the rendered result in a grid over each text
  region and judge the WORST cell, not the average (≥4.5:1 for small text, ≥3:1 for large) before
  wiring it in.

## Guards recap
1. **Codex-only override** — default Terra; accept only `terra`/`sol`/`luna`; reject `fable`/unknown.
2. **Separate surface** — never route image gen through the advisory `codex-run.sh` (read-only/text).
3. **Background-run + fail-closed** — long timeout, tree-scoped reap; report only a real saved file.
4. **A5 training gate** honoured; no repo internals in a brief. 5. **Provenance always disclosed** (AI-generated, which model, sub not API).
