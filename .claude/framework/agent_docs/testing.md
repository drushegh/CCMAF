# Testing

<!-- TEMPLATE: Populate this with your project's test framework, conventions, and coverage requirements. -->
<!-- Examples below show a few stacks; delete the ones that don't apply. -->

## Test Framework

<!-- e.g., Vitest / Jest / Pytest / Go test / xUnit / cargo test -->

## Running Tests

```bash
# Node / TypeScript
cd 01_Project && npm test
cd 01_Project && npm run test:e2e    # if applicable

# Python
cd 01_Project && uv run pytest        # or: pytest

# Go
cd 01_Project && go test ./...

# Rust
cd 01_Project && cargo test

# .NET
cd 01_Project && dotnet test
```

## Test Structure

Tests live under `01_Project/` (exact location is stack-specific — set it
here and in CLAUDE.md's Commands section). Typical layouts:

```
# Node / TS (tests alongside source OR a sibling tests/ tree)
01_Project/tests/
├── unit/
├── integration/
└── e2e/

# Python (pytest convention: tests alongside the package or in tests/)
01_Project/tests/

# Go (tests alongside source as *_test.go — no separate tree)

# .NET (separate test projects — e.g. MyApp.Tests/)
01_Project/MyApp.Tests/
```

Document the project's actual choice here so agents don't have to guess.

## Coverage Requirements

<!-- Define minimum coverage thresholds if applicable. -->

## Test Data

<!-- Document how test fixtures, factories, or seed data work. -->
