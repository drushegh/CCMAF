# Delivery & export (environment-aware)

Authoring is the same everywhere; only *delivery* differs. Detect the
environment and pick the cheapest path. Condensed from `jgraph/drawio-mcp`
(`skill-cli`, `project-instructions`) with operational gotchas from
`Agents365-ai/drawio-skill`.

| Environment | Local files | draw.io Desktop | Deliver by |
|---|---|---|---|
| Claude Code | yes | usually | Write `.drawio` → CLI export (below) |
| VS Code | yes | via the Hediet "Draw.io Integration" extension (previews/edits inline; no MCP needed) | Write `.drawio` |
| Cowork | only a connected folder; ephemeral sandbox, no desktop draw.io | no | Write `.drawio` to the folder + optionally a `#create=` URL |
| claude.ai | no (sandboxed) | no | Downloadable `.drawio` + Python-generated `#create=` URL as an HTML artifact |

Detect WSL2 with `grep -qi microsoft /proc/version`.

## Local export — the draw.io Desktop CLI

draw.io Desktop must be installed. Resolve the binary, then export.

### Locate the binary

| OS | Path / command |
|---|---|
| Linux (native) | `drawio` (snap/apt/flatpak put it on PATH) — but **don't use snap on servers** (AppArmor sandbox can crash it) |
| macOS | `drawio` (Homebrew cask) or `/Applications/draw.io.app/Contents/MacOS/draw.io` |
| Windows (native) | `"C:\Program Files\draw.io\draw.io.exe"` |
| WSL2 | `"/mnt/c/Program Files/draw.io/draw.io.exe"` (note the space); per-user fallback `"/mnt/c/Users/$WIN_USER/AppData/Local/Programs/draw.io/draw.io.exe"` |

Check `command -v drawio` / `command -v draw.io` (older installs keep the dot)
before falling back to a platform path.

### Export command

```bash
drawio -x -f png -e -b 10 -o diagram.drawio.png diagram.drawio
```

Key flags: `-x` export · `-f` format (`png` `svg` `pdf` `jpg`) · `-o` output ·
`-e` embed the editable XML in the output · `-b` border (use 10) · `-t`
transparent (PNG) · `-s` scale (2 for a crisp final PNG) · `--width`/`--height`
fit to size (no short `-w` — passing `-w` silently breaks input parsing) ·
`-a` all pages (PDF) · `--page-index` 1-based page.

`-e` (embed) is supported for **PNG, SVG and PDF** on current draw.io Desktop —
the export stays editable in draw.io. *Caveat: some older CLI builds documented
`-e` as PNG-only; verify against the installed version if SVG/PDF embedding
matters.*

### Open the result

| Env | Command |
|---|---|
| macOS | `open <file>` |
| Linux | `xdg-open <file>` |
| Windows | `start <file>` |
| WSL2 | `cmd.exe /c start "" "$(wslpath -w <file>)"` |

### Naming

Descriptive, lowercase-hyphenated (`login-flow`, `database-schema`). Exports use
a **double extension** to signal embedded XML: `name.drawio.png`. After a
successful export, delete the intermediate `.drawio` (the export already
contains the full diagram). For `url` mode keep the single-extension `.drawio`.

## Sandbox / no-desktop — the `#create=` URL

Carries the whole diagram in the URL **hash fragment**, which the browser never
sends to a server (nothing is uploaded). Two ways to build it:

**Node (built-in `zlib`, no deps) — good in Claude Code / Cowork:**

```bash
URL=$(node -e '
const fs=require("fs"),zlib=require("zlib");
const xml=fs.readFileSync(process.argv[1],"utf8");
const c=zlib.deflateRawSync(encodeURIComponent(xml)).toString("base64");
const p=encodeURIComponent(JSON.stringify({type:"xml",compressed:true,data:c}));
console.log("https://app.diagrams.net/?grid=0&pv=0&border=10&edit=_blank#create="+p);
' diagram.drawio)
```

**Python (stdlib) — shipped as `scripts/encode_drawio_url.py`, good in
claude.ai:** `python3 scripts/encode_drawio_url.py [--edit] diagram.drawio`
(default prints a read-only `viewer.diagrams.net` URL; `--edit` prints an
editable `app.diagrams.net#create=` URL). The `encodeURIComponent`-before-
deflate step is mandatory — without it any `%` or non-ASCII label makes the
browser throw "URI malformed". Node's `deflateRawSync` and Python's raw-deflate
produce interchangeable output.

**Opening / surfacing the URL:**

- macOS `open "$URL"` · Linux `xdg-open "$URL"`.
- **Windows / WSL2:** `cmd.exe`'s `start` treats `&` as a separator and drops
  everything after `#` — so it silently loses the diagram. Write a `.url`
  shortcut and open *that*:

  ```bash
  TMP=$(mktemp --suffix=.url)
  printf '[InternetShortcut]\r\nURL=%s\r\n' "$URL" > "$TMP"
  cmd.exe /c start "" "$(wslpath -w "$TMP")"
  ```

- **claude.ai:** never retype the URL into chat (base64 corrupts token-by-
  token). Run the script and emit its output as an **HTML artifact** with a
  pre-built "Open in draw.io" button — the artifact is the delivery mechanism.
- **Cowork:** write the `.drawio` into the connected folder as the persistent
  artifact; the URL is an optional convenience.
- **Length:** very large diagrams can exceed browser URL limits — fall back to
  the `.drawio` file.

## Export / CLI gotchas (hard-won — from Agents365)

- **`-e` PNGs break vision APIs.** draw.io truncates the PNG IEND chunk under
  `-e`; Claude's vision returns 400 "Could not process image". For a preview
  you'll *look* at, export **without `-e`**; keep `-e` only for the final
  deliverable.
- **Vision ceiling 2576×2576px.** For a preview to self-check, cap with
  `--width 2000` — **not** `-s 2` (which overshoots on medium diagrams).
- **Headless Linux/CI:** `xvfb-run -a drawio …`; `export HOME=/tmp` if home is
  unwritable; add `--disable-gpu` on GL errors; if running as root append
  `--no-sandbox` **at the very end** (earlier, drawio treats it as the input
  filename).
- **macOS sandbox isolation** (e.g. codex.app) can crash the CLI even on
  `--version` — treat as unavailable, don't retry; use the URL fallback.

## Fallback chain

| Situation | Do |
|---|---|
| CLI missing, Python present | URL fallback (`encode_drawio_url.py`) |
| CLI missing, Python missing | Deliver `.drawio` only; tell the user to open it in draw.io Desktop or diagrams.net |
| CLI crashes in a sandbox | Treat as unavailable; URL/XML only; ask the user to export on a real host |
| Vision unavailable | Skip the render self-check; deliver the preview/`.drawio` directly |

## Optional add-on — MCP

Not required (the skill is self-contained), but useful where a host supports it:

- **Hosted MCP App server** `https://mcp.draw.io/mcp` (no install) — renders
  diagrams **inline** in MCP-Apps hosts (Claude.ai, VS Code). In hosts without
  MCP Apps support it degrades to returning the XML as text. Also exposes
  `search_shapes` over 10k+ shapes.
- **MCP Tool server** `npx -y @drawio/mcp` — opens the diagram in a browser
  tab; supports XML, CSV and Mermaid.

**Mermaid / CSV:** these need draw.io's server-side conversion and can't be
written as native `.drawio` by the model — route them through one of the MCP
servers above or `app.diagrams.net`. To stay fully local, author native XML.
