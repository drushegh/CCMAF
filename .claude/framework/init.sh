#!/bin/bash
# .claude/framework/init.sh — Detect stack, install dependencies, optionally start dev server.
# Called during Cold Start to verify the project is in a working state.
#
# Diagnostic, not blocking: reports status and continues. Do NOT use set -e —
# a failed smoke test should not prevent the agent from starting work.
#
# Stack detection runs by probing manifest files under 01_Project/. Each stack
# branch is self-contained; add more as needed for your languages.

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 0

PROJECT_DIR="01_Project"
if [ ! -d "$PROJECT_DIR" ]; then
  echo "ℹ️ No 01_Project/ directory — framework is in scaffold state or the project"
  echo "   root has been customised. Override this script if your layout differs."
  echo "Ready to work (no project root)."
  exit 0
fi

echo "🔧 Detecting project stack..."
STACK="unknown"
if [ -f "$PROJECT_DIR/package.json" ]; then STACK="node"
elif [ -f "$PROJECT_DIR/pyproject.toml" ] || [ -f "$PROJECT_DIR/requirements.txt" ]; then STACK="python"
elif [ -f "$PROJECT_DIR/go.mod" ]; then STACK="go"
elif [ -f "$PROJECT_DIR/Cargo.toml" ]; then STACK="rust"
elif find "$PROJECT_DIR" -maxdepth 3 -type f \( -name "*.csproj" -o -name "*.sln" -o -name "*.fsproj" \) 2>/dev/null | grep -q .; then
  STACK="dotnet"
fi
echo "   Stack: $STACK"

# ── Skills suggestions (TASK-036) ──
# Runs ONLY for projects that opted into skills sync (.skills-version
# exists) — suggest-only output, never installs, no nag for non-adopters.
if [ -f ".claude/.skills-version" ] && [ -f ".claude/framework/update/skills-sync.sh" ]; then
  bash .claude/framework/update/skills-sync.sh --suggest 2>/dev/null || true
fi

# ── Stack-specific dependency bootstrap ──
case "$STACK" in
  node)
    if [ ! -d "$PROJECT_DIR/node_modules" ]; then
      echo "📦 Installing Node dependencies..."
      (cd "$PROJECT_DIR" && npm install) || echo "⚠️ npm install had issues — check manually"
    fi
    if [ -f "$PROJECT_DIR/prisma/schema.prisma" ]; then
      echo "🗄️ Generating Prisma client..."
      (cd "$PROJECT_DIR" && npx prisma generate 2>/dev/null) || echo "⚠️ Prisma generate failed — database may not be configured yet"
    fi
    ;;
  python)
    if [ -f "$PROJECT_DIR/pyproject.toml" ] && command -v uv &>/dev/null; then
      if [ ! -d "$PROJECT_DIR/.venv" ]; then
        echo "📦 Syncing Python environment (uv)..."
        (cd "$PROJECT_DIR" && uv sync) || echo "⚠️ uv sync had issues — check manually"
      fi
    elif [ -f "$PROJECT_DIR/requirements.txt" ] && [ ! -d "$PROJECT_DIR/.venv" ]; then
      echo "📦 Creating venv + installing requirements.txt..."
      (cd "$PROJECT_DIR" && python -m venv .venv && .venv/bin/pip install -q -r requirements.txt) || echo "⚠️ pip install had issues"
    fi
    ;;
  go)
    echo "📦 Downloading Go modules..."
    (cd "$PROJECT_DIR" && go mod download 2>/dev/null) || echo "⚠️ go mod download had issues"
    ;;
  rust)
    if [ ! -d "$PROJECT_DIR/target" ]; then
      echo "📦 Fetching Rust dependencies..."
      (cd "$PROJECT_DIR" && cargo fetch 2>/dev/null) || echo "⚠️ cargo fetch had issues"
    fi
    ;;
  dotnet)
    if [ ! -d "$PROJECT_DIR/obj" ] && ! find "$PROJECT_DIR" -maxdepth 3 -type d -name "obj" 2>/dev/null | grep -q .; then
      echo "📦 Restoring NuGet packages..."
      (cd "$PROJECT_DIR" && dotnet restore) || echo "⚠️ dotnet restore had issues"
    fi
    ;;
esac

# ── Dev server startup ──
# Only Node has a universal "dev server on :3000" convention. For other stacks,
# report the stack and defer to CLAUDE.md's Commands section for run instructions.
PORT="${CLAUDE_DEV_PORT:-3000}"

if [ "$STACK" != "node" ]; then
  echo "ℹ️ No default dev-server startup for $STACK."
  echo "   See CLAUDE.md Commands for how to run this project. Override this"
  echo "   script with your own dev-server logic if auto-start is useful."
  echo ""
  echo "Ready to work."
  exit 0
fi

# Node path — preserve original smoke-test behaviour
if ! grep -q '"dev"' "$PROJECT_DIR/package.json" 2>/dev/null; then
  echo "ℹ️ No 'dev' script in package.json — skipping server startup."
  echo "Ready to work (no server)."
  exit 0
fi

if curl -s "http://localhost:$PORT" > /dev/null 2>&1; then
  echo "✅ Dev server already running on http://localhost:$PORT"
else
  echo "🚀 Starting dev server..."
  (cd "$PROJECT_DIR" && npm run dev) &

  echo "⏳ Waiting for server..."
  for i in $(seq 1 30); do
    if curl -s "http://localhost:$PORT" > /dev/null 2>&1; then
      echo "✅ Server is running on http://localhost:$PORT"
      break
    fi
    sleep 1
  done

  if ! curl -s "http://localhost:$PORT" > /dev/null 2>&1; then
    echo "⚠️ Server didn't start within 30s — may need configuration."
  fi
fi

# Optional smoke test
if curl -s "http://localhost:$PORT" > /dev/null 2>&1; then
  HEALTH=$(curl -s "http://localhost:$PORT/api/health" 2>/dev/null)
  if echo "$HEALTH" | grep -q "ok"; then
    echo "✅ /api/health → ok"
  fi
fi

echo ""
echo "Ready to work."
