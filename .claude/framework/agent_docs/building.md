# Building & Development

<!-- TEMPLATE: Populate this with your project's specific build commands and dev setup. -->
<!-- Examples below show a few stacks; delete the ones that don't apply and fill in your own. -->

## Dev Environment Setup

```bash
# Node / TypeScript
cd 01_Project && npm install

# Python (pyproject.toml + uv — preferred)
cd 01_Project && uv sync

# Python (requirements.txt)
cd 01_Project && python -m venv .venv && .venv/bin/pip install -r requirements.txt

# Go
cd 01_Project && go mod download

# Rust
cd 01_Project && cargo fetch

# .NET
cd 01_Project && dotnet restore
```

## Dev Server / Run

```bash
# Node / TypeScript
cd 01_Project && npm run dev

# Python (FastAPI / Uvicorn example)
cd 01_Project && uv run uvicorn app.main:app --reload

# Go (example: cmd/server main package)
cd 01_Project && go run ./cmd/server

# .NET
cd 01_Project && dotnet run
```

## Production Build

```bash
# Node / TypeScript
cd 01_Project && npm run build

# Python (wheel)
cd 01_Project && uv build

# Go
cd 01_Project && go build -o ./bin/app ./cmd/server

# Rust
cd 01_Project && cargo build --release

# .NET
cd 01_Project && dotnet publish -c Release
```

## Dependencies

<!-- Document any non-obvious dependencies, environment requirements, or setup steps. -->
<!-- e.g., database URL env var, required system libraries, platform-specific tooling. -->

## MCP Servers Required

<!-- List any MCP servers that developers need to set up (code-graph, database tools, etc.) -->
