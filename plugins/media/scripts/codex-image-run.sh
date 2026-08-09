#!/usr/bin/env bash
set -euo pipefail
# codex-image-run.sh <advisor> <outdir> <slug> <brief-file>
#
# Generate a raster image with codex's BUILT-IN `image_gen` tool (bundled `imagegen` skill),
# driven through the same ChatGPT-sub codex provider as /sol//terra//luna — but this is a
# SEPARATE surface from the advisory runner (codex-run.sh) and must stay separate:
#
#   codex-run.sh        → advisory TEXT: ephemeral CODEX_HOME, -s read-only, "don't touch files".
#   codex-image-run.sh  → image WORKSPACE-WRITE: the REAL CODEX_HOME (the imagegen skill lives
#                         there), -s workspace-write scoped to <outdir>, model saves the asset.
#
# Provenance/cost: runs on the ChatGPT SUBSCRIPTION built-in tool — NO OPENAI_API_KEY, zero
# metered spend. The model is pinned per-invocation from the registry ([advisors.<advisor>])
# for provenance; the IMAGE comes from the built-in tool, not the LLM "drawing".
#
# Args:
#   <advisor>    a codex advisor id (terra | sol | luna) — picks the model pin.
#   <outdir>     directory to save into (created if absent); workspace-write is SCOPED here.
#   <slug>       kebab name for the asset + run bookkeeping (image → <outdir>/<slug>.png).
#   <brief-file> a file containing the image brief (the command stages this).
#
# Writes bookkeeping to _advisors/.imageruns/<slug>/ (git-ignored) and the image to <outdir>.
# Prints, and records in .../status: OK <path> | TIMEOUT | ERROR | UNAVAILABLE.
#
# Verified mechanism (TERRA-IMAGEGEN-RECIPE, 2026-07-15, codex-cli 0.144.1, Windows). Gen takes
# ~1.5-3 min (past a 2-min foreground cap) so the call is BACKGROUNDED with a hard timeout and a
# SCOPED straggler reap (the codex process TREE only — never a blanket `taskkill /IM codex.exe`,
# which would also kill the user's editor-extension codex).

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/advisors-lib.sh"
# shellcheck source=plugins/media/scripts/advisors-lib.sh disable=SC1091
. "$LIB"
CODEX_PREFLIGHT="$(dirname "${BASH_SOURCE[0]}")/codex-preflight.sh"

advisor="${1:?usage: codex-image-run.sh <advisor> <outdir> <slug> <brief-file>}"
outdir="${2:?missing <outdir>}"
slug="${3:?missing <slug>}"
brief_file="${4:?missing <brief-file>}"

repo="$(advisors_repo_root)"
run_dir="$repo/_advisors/.imageruns/$slug"
mkdir -p "$run_dir"

status() { printf '%s\n' "$1" > "$run_dir/status"; printf 'codex-image-run: %s\n' "$1"; }

# ── Registry bootstrap (first use) + resolution (codex-only) ─────────────────────────────
# Standalone repos start with NO registry anywhere; create the live one from the shipped
# template at the resolved path (project .claude/ if present, else ~/.claude/) before reading.
advisors_ensure_registry >/dev/null || { status "ERROR could not create the advisors registry (see stderr)"; exit 2; }
provider="$(registry_get "advisors.$advisor" provider)"
model="$(registry_get "advisors.$advisor" model)"
effort="$(registry_get "advisors.$advisor" effort)"
timeout_min="$(registry_get providers.codex timeout_min)"; timeout_min="${timeout_min:-20}"
if [[ "$provider" != "codex" ]]; then
  status "ERROR advisor '$advisor' is provider '$provider', not codex — image gen needs a codex model (check [advisors.$advisor] in $(advisors_registry_path))"; exit 2
fi
if [[ -z "$model" ]]; then
  status "ERROR no model for advisor '$advisor' in the registry"; exit 2
fi
if [[ ! -f "$brief_file" ]]; then
  status "ERROR brief file missing: $brief_file"; exit 2
fi

# ── Preflight (A3/A4/A5/A7) — fail loud, do not silently proceed ──────────────────────────
if ! bash "$CODEX_PREFLIGHT" > "$run_dir/preflight.txt" 2>&1; then
  cat "$run_dir/preflight.txt"
  status "UNAVAILABLE preflight FAILED — see $run_dir/preflight.txt (codex not ready)"; exit 3
fi
CODEX="${CODEX_BIN:-$(command -v codex)}"

# ── The REAL codex home (the imagegen skill lives there — NOT an ephemeral copy) ──────────
real_home="${CODEX_HOME:-$HOME/.codex}"
if [[ ! -e "$real_home/skills/.system/imagegen/SKILL.md" ]]; then
  # Not fatal — some builds resolve the skill differently — but warn so a missing skill is visible.
  printf 'codex-image-run: WARNING imagegen skill not found under %s/skills/.system/imagegen (may still resolve)\n' "$real_home" >&2
fi

# ── Output dir (workspace-write is scoped to this) + the deterministic target path ────────
mkdir -p "$outdir"
outdir_abs="$(cd "$outdir" && pwd)"
target="$outdir_abs/$slug.png"
rm -f "$target"

# ── Build the prompt: use image_gen, save to the exact path, honour the copy-zone contract ─
prompt="$(cat <<PROMPT
Generate ONE image using your built-in image_gen tool (built-in mode — no API key).

=== IMAGE BRIEF ===
$(cat "$brief_file")
=== END BRIEF ===

SAVE the final image as a PNG to EXACTLY this absolute path (create nothing else, edit no other
files): $target
Then, as the VERY LAST line of your reply, print exactly:
SAVED: <the absolute path you actually wrote>

If the brief describes art that will sit UNDER text (a hero, banner, or header), name the
copy-zone in your composition and pin that region as the DARKEST part of the frame so overlaid
text stays legible (e.g. keep the upper-left third near-black if the headline sits there).
PROMPT
)"

# ── Run: BACKGROUNDED (hold the PID), real home, workspace-write scoped to <outdir> ───────
: > "$run_dir/last.txt"
printf '%s' "$prompt" | env CODEX_HOME="$real_home" "$CODEX" exec \
  -m "$model" \
  -c "model_reasoning_effort=$effort" \
  -s workspace-write \
  -C "$outdir_abs" \
  --skip-git-repo-check \
  --json \
  -o "$run_dir/last.txt" \
  - > "$run_dir/events.jsonl" 2>"$run_dir/err.txt" &
codex_pid=$!

# ── Bounded wait to the hard deadline; on timeout, SCOPED tree-kill (never blanket) ───────
deadline=$(( $(date +%s) + timeout_min * 60 ))
timed_out=0
while kill -0 "$codex_pid" 2>/dev/null; do
  if [ "$(date +%s)" -ge "$deadline" ]; then timed_out=1; break; fi
  sleep 3
done

rc=0
if [ "$timed_out" -eq 1 ]; then
  # Kill the codex process TREE only. Windows: map MSYS pid -> Windows pid via /proc/<pid>/winpid
  # and taskkill /T (whole tree). POSIX: the pid plus its direct children. Deliberately NOT
  # `taskkill /IM codex.exe` / `pkill -f 'codex exec'` — those also kill the user's editor codex.
  if [ -r "/proc/$codex_pid/winpid" ]; then
    winpid="$(cat "/proc/$codex_pid/winpid" 2>/dev/null || true)"
    if [ -n "$winpid" ]; then MSYS_NO_PATHCONV=1 taskkill /F /T /PID "$winpid" >/dev/null 2>&1 || true; fi
  else
    pkill -KILL -P "$codex_pid" 2>/dev/null || true
  fi
  kill -TERM "$codex_pid" 2>/dev/null || true; sleep 2; kill -KILL "$codex_pid" 2>/dev/null || true
  wait "$codex_pid" 2>/dev/null || true
  status "TIMEOUT after ${timeout_min}m — codex killed (tree-scoped); partial/none. Check $run_dir/err.txt"
  exit 4
fi
wait "$codex_pid" || rc=$?

if [[ "$rc" -ne 0 ]]; then
  status "ERROR codex exec rc=$rc — see $run_dir/err.txt / events.jsonl"
  exit 5
fi

# ── Locate the produced image: target path → SAVED: line → generated_images fallback ──────
saved=""
if [[ -s "$target" ]]; then
  saved="$target"
else
  # The model may have written elsewhere; trust its reported path if it exists.
  reported="$(grep -aE '^SAVED:' "$run_dir/last.txt" 2>/dev/null | tail -1 | sed 's/^SAVED:[[:space:]]*//')"
  if [[ -n "$reported" && -f "$reported" ]]; then
    cp -f "$reported" "$target" 2>/dev/null && saved="$target" || saved="$reported"
  fi
fi
if [[ -z "$saved" ]]; then
  # Fallback: built-in mode may leave it under $CODEX_HOME/generated_images/<session>/ un-moved.
  # Constrain to files created AFTER this run started (preflight.txt is the run-start marker) —
  # a stale image from an earlier session must never be reported as this run's output.
  newest="$(find "$real_home/generated_images" -type f \( -iname '*.png' -o -iname '*.webp' -o -iname '*.jpg' \) -newer "$run_dir/preflight.txt" 2>/dev/null | sort | tail -1)"
  if [[ -n "$newest" && -f "$newest" ]]; then
    cp -f "$newest" "$target" 2>/dev/null && saved="$target" || saved="$newest"
  fi
fi

if [[ -z "$saved" ]]; then
  status "ERROR codex finished (rc=0) but no image was found — see $run_dir/last.txt / err.txt"
  exit 5
fi

# ── Auto-emit a compressed WebP sibling (Pillow-guarded; opt-out CLAUDE_IMAGE_NO_WEBP=1) ──
# Built-in mode emits multi-MB PNG; READMEs/docs want a ~KB webp. Emit one next to the PNG so
# the caller has a ready-to-use asset without a manual Pillow pass (recipe §5). Best-effort:
# a missing Python/Pillow just skips it — never fails the run.
webp=""
if [[ "$saved" == *.png && "${CLAUDE_IMAGE_NO_WEBP:-0}" != 1 ]]; then
  _py="$(command -v python3 || command -v python || true)"
  if [[ -n "$_py" ]] && "$_py" -c 'import PIL' >/dev/null 2>&1; then
    webp="${saved%.png}.webp"
    "$_py" - "$saved" "$webp" >/dev/null 2>&1 <<'PYEOF' || webp=""
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
w, h = im.size
if w > 1600:
    im = im.resize((1600, round(h * 1600 / w)), Image.LANCZOS)
im.save(dst, format="WEBP", quality=82, method=6)
PYEOF
    [[ -f "$webp" ]] || webp=""
  fi
fi

if [[ -n "$webp" ]]; then
  status "OK $saved (+ webp $webp) (model=$model, ChatGPT-sub built-in image_gen — AI-generated)"
else
  status "OK $saved (model=$model, ChatGPT-sub built-in image_gen — AI-generated)"
fi
exit 0
