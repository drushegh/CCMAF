# Headless Automation and Batch Processing

## CLI fundamentals

```bash
# Run a script against a file, headless
blender -b assets/scene.blend -P scripts/process.py -- --preset web

# Fresh file, pure procedural generation
blender -b -P scripts/generate.py -- --out /exports

# Render: frame / animation with overrides
blender -b scene.blend -o //renders/frame_#### -F PNG -f 12
blender -b scene.blend -E CYCLES -s 1 -e 250 -a

# Extensions CLI
blender --command extension validate
blender --command extension build
```

- `-b` (background) first; argument ORDER MATTERS (`-P` runs when
  encountered); everything after `--` reaches the script via
  `sys.argv` (parse with argparse on `sys.argv[sys.argv.index('--')+1:]`).
- Exit codes: uncaught Python exceptions set non-zero — let them
  propagate for CI; print structured progress to stdout for logs.

## Headless script discipline

- `bpy.data` everywhere; no `bpy.ops` that need screen context
  (no window/area exists). Mode-dependent ops: ensure Object Mode.
- Save explicitly: `bpy.ops.wm.save_as_mainfile(filepath=...)`;
  export via the format ops with full keyword args (no UI defaults
  to lean on).
- GPU in headless: Cycles devices via
  `bpy.context.preferences.addons['cycles'].preferences` device
  setup — configure explicitly per machine/CI runner; verify
  `supported_devices` rather than assuming.
- Memory: process one asset per Blender invocation in big batches
  (subprocess per file from an orchestrator script) — long-lived
  sessions accumulate data-blocks; or aggressively
  `bpy.data.*.remove()` + `bpy.ops.outliner.orphans_purge`.

## Batch pipeline shape (the manifest pattern)

```python
# orchestrator (plain Python, NOT inside Blender)
import subprocess, json, sys

manifest = json.load(open("assets/manifest.json"))
for asset in manifest["assets"]:
    result = subprocess.run([
        "blender", "-b", asset["blend"],
        "-P", "scripts/export_one.py", "--",
        "--object", asset["object"],
        "--out", asset["out"],
    ], capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        print(f"FAIL {asset['object']}:\n{result.stderr[-2000:]}", file=sys.stderr)
        sys.exit(1)
```

Manifest-driven (JSON/CSV of asset → settings → output), one
subprocess per asset, fail fast with captured stderr. The in-Blender
script stays dumb: parse args, load/select, export, exit.

## CI integration

- Containerised Blender (official images / apt in CI) for
  reproducible versions — pin the exact version (API drift!).
- Pipelines: validate extensions, run bpy unit tests
  (`blender -b -P run_tests.py` wrapping unittest/pytest-in-Blender),
  regenerate exports on asset changes, diff file sizes/budgets
  against thresholds (`threejs-development` budget gates).
- Render farms: frame-range sharding (`-s/-e` per node) is the
  simple effective split; seed output naming with job IDs.
- Hosting/runners → `devops-development`; the Blender CLI specifics
  stay here.

## Quality gates worth automating

Per-asset validation script: applied transforms (scale ≈ 1),
triangle/material counts vs budget, UV presence (+ overlaps for
lightmap channels), missing texture paths, naming convention
compliance, orphaned data-blocks. Run pre-export; fail loudly — these
five checks catch most pipeline breakage before the engine does.
