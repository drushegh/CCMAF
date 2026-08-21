# Architecture

<!-- TEMPLATE: Populate this with your project's module structure, data flow, and key design decisions. -->
<!-- This is a reference for agents to understand how the system fits together. -->

## System Overview

<!-- High-level description of the system and its major components. -->

## Module Structure

Project code lives under `01_Project/`. The exact layout is stack-specific —
document the actual shape here so agents navigate correctly. Example layouts:

```
# Node / TypeScript monolith (common layout)
01_Project/src/
├── api/              # Route handlers
├── services/         # Business logic
├── db/               # Database access
├── components/       # UI components (if frontend)
├── lib/              # Shared utilities
└── types/            # Shared types

# Python (src layout)
01_Project/src/<package>/
├── api/              # FastAPI/Flask routers, etc.
├── services/
├── models/
└── core/

# Go
01_Project/
├── cmd/              # Command entry points (cmd/server/main.go, etc.)
├── internal/         # Private packages
├── pkg/              # Public packages (if library)
└── api/              # Generated API clients or route definitions

# .NET
01_Project/
├── MyApp/            # Main project (MyApp.csproj)
├── MyApp.Core/       # Domain / business logic
├── MyApp.Infra/      # Infrastructure / data access
└── MyApp.Tests/      # Test project
```

## Data Flow

<!-- Describe the request lifecycle: how data flows from input to output. -->

## Key Design Decisions

<!-- Reference the project's decisions source (DECISIONS.md or decisions/) -->
<!-- for detailed rationale. Summarise the big ones here. -->

## External Dependencies

<!-- List external APIs, services, and their integration points. -->

## Deployment Architecture

<!-- How the system is deployed: hosting, CDN, database, queues, etc. -->
