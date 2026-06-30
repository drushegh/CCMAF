# Project Ecosystem — Source of Truth

<!-- Contracts are the shared interface agreements between agents. -->
<!-- Every task in TASKS.md references its relevant contract by ID (e.g., "Contract: contract:user-registration"). -->
<!-- When this file exceeds ~300 lines, split into per-module files in .claude/framework/agent_docs/contracts/ -->

<!-- CONTRACT FORMAT:
     Each contract has two parts:
     1. Prose description: human-readable context, business rules, edge cases
     2. Machine-readable spec: fenced code block with a stable ID anchor

     Anchor format:    contract:IDENTIFIER status:draft|stable
     (placed in an HTML comment before the fenced block)

     - status:draft  = design in progress, NOT ready for implementation
     - status:stable = reviewed and confirmed, safe to implement against

     Reference from TASKS.md:  "Contract: contract:IDENTIFIER"
     The developer agent will REFUSE to implement against draft contracts.

     The machine-readable block is the ENFORCEABLE spec. The prose is context.
     If they conflict, update both, but the code block is what agents validate against.

     Supported formats (use whichever fits your stack):
     - typescript: TypeScript interfaces/types
     - json-schema: JSON Schema for request/response validation
     - openapi: OpenAPI fragments for API contracts
     - sql: Table schemas for database contracts
     - graphql: GraphQL type definitions
-->

## API Contracts

<!-- DELETE THIS EXAMPLE — replace with your project's actual contracts. -->
<!-- The example is deliberately status:draft so the developer agent refuses to
     implement against it if it's accidentally left in place. Your real contracts
     get status:stable once the design is confirmed. -->
<!-- contract:user-registration status:draft -->

### POST /api/users — User Registration

Creates a new user account. Returns 409 if email already exists.
Rate limit: 5 attempts per IP per hour.

```typescript
// Request
interface CreateUserRequest {
  email: string; // Must be valid email format
  name: string; // 1-100 characters
  password: string; // Minimum 8 characters, at least one number
}

// Response 201
interface CreateUserResponse {
  id: string;
  email: string;
  name: string;
  createdAt: string; // ISO 8601
}

// Error 400
interface ValidationError {
  error: string;
  details: { field: string; message: string }[];
}

// Error 409
interface ConflictError {
  error: "Email already registered";
}
```

<!-- END EXAMPLE -->

## Shared Types

<!-- DELETE THIS EXAMPLE — replace with your project's actual shared types. -->
<!-- Deliberately status:draft; see the note on the example above. -->
<!-- contract:shared-types status:draft -->

```typescript
interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

interface ApiError {
  error: string;
  details?: { field: string; message: string }[];
}
```

<!-- END EXAMPLE -->

## Module Boundaries & File Ownership

| Module | Owner Role | Files | Notes |
| ------ | ---------- | ----- | ----- |

## Design Tokens
