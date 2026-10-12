#!/usr/bin/env bats
# Tests for plugins/ccmaf/scripts/board-move.sh (fleet audit 2026-10-12,
# unit A — C2/C11): parse-by-ID block moves between ### sections of
# TASKS.md, refusing (non-zero, no write) on missing targets, keeping line
# endings, never losing a block.

load helpers

BM="$FW_REPO_ROOT/plugins/ccmaf/scripts/board-move.sh"

setup() {
  [ -f "$BM" ] || skip "ccmaf plugin not present (consumer checkout)"
  B="$BATS_TEST_TMPDIR/TASKS.md"
  cat > "$B" <<'EOF'
# Task Board

## Feature Lane

<!-- Task entries are BRACKETED level-4 headings: `#### [TASK-N] Title [P1]`. -->

### In Progress

#### [TASK-1] First task [P1]
- **Spec:** one
```
#### [TASK-99] not a heading, inside a fence
```

#### [TASK-2] Second task [P2]
- body two

### Ready for Review

### Verify

### Todo (Priority Order)

#### [TASK-3] Third [P3]

### Done

<!-- When Done exceeds ~20 items, run /housekeeping -->

---

## Bug-Fix Lane

### Fixing

#### [BUG-7] A bug
- **Severity:** P2

### Verify

### Reported

<!-- Template:
#### [BUG-8] Short description
-->

### Done
EOF
}

# raw heading-line count (fenced/commented lookalikes included — it is an invariant, not a parse)
blocks() { tr -d '\r' < "$1" | grep -cE '^#### \[(TASK|BUG)-[0-9]+\]'; }
# section_of <file> <id> -> the ### heading text above the id's heading
section_of() { tr -d '\r' < "$1" | awk -v id="[$2]" '/^### /{s=substr($0,5)} index($0,"#### " id)==1{print s}'; }

@test "board-move: moves a block (with its fenced body) to the target section" {
  run bash "$BM" TASK-1 "Ready for Review" --file "$B"
  [ "$status" -eq 0 ]
  [[ "$output" == *"moved TASK-1"* ]]
  [ "$(section_of "$B" TASK-1)" = "Ready for Review" ]
  grep -q '^- \*\*Spec:\*\* one' "$B"
  [ "$(blocks "$B")" -eq 6 ]
  # skeleton intact
  grep -q '^### In Progress' "$B"
  [ "$(section_of "$B" TASK-2)" = "In Progress" ]
}

@test "board-move: unique prefix match resolves 'Todo' and stays in the block's lane" {
  run bash "$BM" TASK-2 Todo --file "$B"
  [ "$status" -eq 0 ]
  [ "$(section_of "$B" TASK-2)" = "Todo (Priority Order)" ]
  # top insertion: TASK-2 now precedes TASK-3
  [ "$(grep -n 'TASK-2\]' "$B" | cut -d: -f1)" -lt "$(grep -n 'TASK-3\]' "$B" | cut -d: -f1)" ]
}

@test "board-move: Verify resolves inside the bug lane for a BUG id (no cross-lane slicing)" {
  run bash "$BM" BUG-7 Verify --file "$B"
  [ "$status" -eq 0 ]
  ln_bug=$(grep -n 'BUG-7\]' "$B" | cut -d: -f1)
  ln_lane=$(grep -n '^## Bug-Fix Lane' "$B" | cut -d: -f1)
  [ "$ln_bug" -gt "$ln_lane" ]
  [ "$(section_of "$B" BUG-7)" = "Verify" ]
}

@test "board-move: last Done block does not drag the section comment or --- rule along" {
  bash "$BM" TASK-3 Done --file "$B"
  run bash "$BM" TASK-3 Verify --file "$B"
  [ "$status" -eq 0 ]
  # comment + hr still sit between Feature Done and the bug lane
  awk '/^### Done/{d=1} d&&/When Done exceeds/{c=1} d&&c&&/^---$/{ok=1} END{exit !ok}' "$B"
  [ "$(section_of "$B" TASK-3)" = "Verify" ]
}

@test "board-move: --bottom appends after the section's last block" {
  run bash "$BM" TASK-3 "In Progress" --bottom --file "$B"
  [ "$status" -eq 0 ]
  [ "$(grep -n 'TASK-3\]' "$B" | cut -d: -f1)" -gt "$(grep -n 'TASK-2\]' "$B" | cut -d: -f1)" ]
}

@test "board-move: missing ID refuses non-zero and leaves the file byte-identical" {
  cp "$B" "$B.orig"
  run bash "$BM" TASK-404 Done --file "$B"
  [ "$status" -eq 3 ]
  [[ "$output" == *"not found"* ]]
  cmp "$B" "$B.orig"
}

@test "board-move: missing target section refuses non-zero and leaves the file byte-identical" {
  cp "$B" "$B.orig"
  run bash "$BM" TASK-1 "Ready for Nothing" --file "$B"
  [ "$status" -eq 4 ]
  [[ "$output" == *"not found"* ]]
  cmp "$B" "$B.orig"
  # no temp litter beside the board
  [ -z "$(ls -A "$BATS_TEST_TMPDIR" | grep board-move || true)" ]
}

@test "board-move: a commented-out template id is not a block" {
  cp "$B" "$B.orig"
  run bash "$BM" BUG-8 Done --file "$B"
  [ "$status" -ne 0 ]
  cmp "$B" "$B.orig"
}

@test "board-move: duplicate ID refuses (ambiguous) without writing" {
  printf '\n#### [TASK-1] dup\n' >> "$B"
  cp "$B" "$B.orig"
  run bash "$BM" TASK-1 Done --file "$B"
  [ "$status" -eq 3 ]
  cmp "$B" "$B.orig"
}

@test "board-move: already in target is a no-op exit 0" {
  cp "$B" "$B.orig"
  run bash "$BM" TASK-1 "In Progress" --file "$B"
  [ "$status" -eq 0 ]
  [[ "$output" == *"nothing to do"* ]]
  cmp "$B" "$B.orig"
}

@test "board-move: CRLF board stays CRLF on every line and keeps all blocks" {
  sed 's/$/\r/' "$B" > "$B.crlf" && mv "$B.crlf" "$B"
  total=$(wc -l < "$B")
  run bash "$BM" TASK-2 "Ready for Review" --file "$B"
  [ "$status" -eq 0 ]
  # every line still ends in CR
  [ "$(grep -c $'\r$' "$B")" -eq "$(wc -l < "$B")" ]
  [ "$(blocks "$B")" -eq 6 ]
  [ "$(section_of "$B" TASK-2)" = "Ready for Review" ]
  # only separator blank lines may differ
  [ $(( $(wc -l < "$B") - total )) -le 2 ]
}

@test "board-move: usage errors exit 2" {
  run bash "$BM" TASK-1
  [ "$status" -eq 2 ]
  run bash "$BM" 'TASK-1;rm' Done --file "$B"
  [ "$status" -eq 2 ]
}

# --- unsafe shapes (review P1-1): refuse with exit 5, board byte-identical ---

@test "board-move: a --- rule inside a block (body text after it) refuses, no write" {
  awk '{print} /^- body two$/{print ""; print "---"; print ""; print "- more notes for task two"}' "$B" > "$B.new" && mv "$B.new" "$B"
  cp "$B" "$B.orig"
  run bash "$BM" TASK-2 "Ready for Review" --file "$B"
  [ "$status" -eq 5 ]
  [[ "$output" == *"cut short"* ]]
  cmp "$B" "$B.orig"
}

@test "board-move: a non-task #### heading inside a block refuses, no write" {
  awk '{print} /^- body two$/{print ""; print "#### Notes"; print "- a note"}' "$B" > "$B.new" && mv "$B.new" "$B"
  cp "$B" "$B.orig"
  run bash "$BM" TASK-2 Done --file "$B"
  [ "$status" -eq 5 ]
  [[ "$output" == *"non-task heading"* ]]
  cmp "$B" "$B.orig"
}

@test "board-move: --bottom refuses when the anchor block is cut short, no write" {
  awk '{print} /^- body two$/{print "#### Notes"; print "- a note"}' "$B" > "$B.new" && mv "$B.new" "$B"
  cp "$B" "$B.orig"
  run bash "$BM" TASK-3 "In Progress" --bottom --file "$B"
  [ "$status" -eq 5 ]
  cmp "$B" "$B.orig"
}

@test "board-move: an unclosed code fence at EOF refuses, no write" {
  printf '\n```\n#### [TASK-50] hidden by the fence\n' >> "$B"
  cp "$B" "$B.orig"
  run bash "$BM" TASK-1 Done --file "$B"
  [ "$status" -eq 5 ]
  [[ "$output" == *"unclosed code fence"* ]]
  cmp "$B" "$B.orig"
}

@test "board-move: an unclosed HTML comment at EOF refuses, no write" {
  printf '\n<!-- note never closed\n#### [TASK-51] hidden by the comment\n' >> "$B"
  cp "$B" "$B.orig"
  run bash "$BM" TASK-2 Done --file "$B"
  [ "$status" -eq 5 ]
  [[ "$output" == *"unclosed HTML comment"* ]]
  cmp "$B" "$B.orig"
}
