---
name: python-development
description: >-
  Modern Python (3.11+) engineering standards, idiomatic patterns, pitfalls,
  and agent workflow rules, with detailed topic references loaded on demand.
  Use this skill whenever any .py file is created, edited, reviewed, or
  debugged — even if the user doesn't mention standards or patterns. Triggers
  include: writing Python modules, scripts, APIs, or packages; pytest and
  test writing; Python tracebacks, exceptions, or unexpected behaviour;
  type annotations or type errors; asyncio or concurrency; slow code,
  profiling, or memory issues; framework choice (FastAPI/Django/Flask),
  project structure, or pyproject.toml setup; refactoring or reviewing any
  Python code.
---

# Python Development

Consolidated Python engineering standards for agents writing production code.
The rules in this file always apply. Load files from `references/` only when
the task touches that topic — do not load them speculatively.

## Core Principles

1. **Readability counts.** Code should be obvious to the next reader. Prefer
   clarity over cleverness.
2. **Explicit over implicit.** No hidden side effects, no magic. Make intent
   clear at the call site.
3. **EAFP.** Prefer `try/except` over precondition checks
   (`try: d[k] except KeyError:` over `if k in d:`).
4. **Principle of least surprise.** When in doubt, do the boring, standard
   thing.

## Code Standards

- **Type hints on all function signatures, return types, class attributes,
  and public APIs.** Local variables: let inference work. Use modern syntax:
  `list[str]`, `dict[str, int]`, `str | None` — not `List`, `Dict`,
  `Optional` from `typing`. Import `Callable`, `Iterable`, `Iterator`,
  `Mapping`, `Sequence` from `collections.abc`, not `typing`.
- **PEP 8 naming, 88-char lines, f-strings** for formatting, `pathlib.Path`
  for paths, `enumerate` for index-element loops.
- **Docstrings** (Google style) on public functions and classes.
- **Small, focused functions.** No god classes, no magic numbers, no
  copy-paste duplication.
- **Dataclasses** for data containers (`@dataclass(slots=True)` when
  instances are numerous); **Pydantic** for anything needing runtime
  validation (API models, config).
- **Minimise `Any`**: use `Protocol` for structural typing, `TypedDict` for
  dicts of known shape. Document why when `Any` is unavoidable.

## Tooling

```bash
uv sync                  # dependency management (preferred over pip)
ruff check . --fix       # lint (covers import sorting)
ruff format .            # format (replaces black + isort)
pyright .                # type check (mypy also acceptable)
pytest                   # tests
```

Configure everything in `pyproject.toml` — see
[references/project-setup.md](references/project-setup.md) for layout and
config templates.

## Decision Rules

**Async vs sync** — I/O-bound (DB, HTTP, files, many concurrent
connections) → async. CPU-bound → sync + multiprocessing. Never mix
carelessly: no sync (blocking) libraries inside async code, no async forced
onto CPU work.

**Framework** — API/microservice → FastAPI. Full-stack/CMS/admin → Django.
Trivial script or minimal service → Flask or stdlib. In an existing repo,
match what is already there; only ask the user for greenfield projects where
the choice is genuinely open.

**Concurrency primitive** — threads (`ThreadPoolExecutor`) for blocking
I/O, processes (`ProcessPoolExecutor`) for CPU, `asyncio` for high-volume
concurrent I/O. Details: [references/async-concurrency.md](references/async-concurrency.md).

**Structure** — script: flat files. Medium app: `app/` package with
`models/`, `routes/`, `services/`, `schemas/`. Large app: `src/` layout.
Business logic lives in services, never in routes/views. Details:
[references/architecture.md](references/architecture.md).

## Critical Pitfalls — always check

```python
# 1. Mutable default arguments — shared across calls
def f(items=None):
    if items is None:          # NOT `items = items or []`
        items = []             # (empty list passed in is falsy)

# 2. Late binding in closures — capture with default arg
funcs = [lambda x=i: x for i in range(3)]

# 3. Missing await — returns a coroutine, not the result
result = await fetch_from_api()

# 4. Identity and type checks
if value is None: ...          # not `== None`
if isinstance(obj, list): ...  # not `type(obj) == list`

# 5. String building in loops — O(n²); use join
result = "".join(str(item) for item in items)
```

Also forbidden: bare `except:`, wildcard imports, swallowing exceptions
silently, N+1 query patterns (use `select_related`/`prefetch_related` or
eager loading).

## Error Handling

Catch **specific** exceptions; chain with `raise ... from e` to preserve
tracebacks; define a custom exception hierarchy per application (base
`AppError`, then `ValidationError`, `NotFoundError`, ...). Error responses
include a code and message, never stack traces. Details:
[references/errors-and-logging.md](references/errors-and-logging.md).

## Security Essentials

- Validate and sanitise all inputs; parameterised SQL only.
- No dynamic code evaluation (`eval`/`exec`) or unsafe deserialisation
  (`pickle`) on untrusted data.
- Crypto: never MD5/SHA-1/DES/RC4 or hand-rolled crypto. Use SHA-256+ for
  hashing, AES-256-GCM for encryption, Argon2/scrypt for passwords,
  `secrets` for tokens, the `cryptography` package for operations.
- Web: rate limiting, CORS/CSRF protection, secure sessions.

## Testing Essentials

pytest only. **All network calls must be mocked** — tests that hit real
services are slow, flaky, and fail in CI sandboxes. Async tests via
`pytest-asyncio`/anyio with `AsyncMock`. Every bug fix gets a regression
test first. Details: [references/testing.md](references/testing.md).

## Performance Rules

**Profile before optimising** — never guess at bottlenecks. Sets/dicts for
membership and lookup (O(1)), `deque` for queues, `Counter` for counting,
generators for large data, `@cache`/`@lru_cache` for memoisation, built-ins
over hand-rolled loops, NumPy for numerical work. Details and profiling
workflow: [references/performance.md](references/performance.md).

## Agent Workflow Rules

1. **Debugging**: follow the systematic process in
   [references/debugging.md](references/debugging.md) — read the traceback
   bottom-up, reproduce minimally, isolate, fix root cause (not symptom),
   verify with a test.
2. **Type errors**: fix all type errors in a file in a single edit —
   fixing one at a time wastes turns and often shifts the error rather than
   resolving it.
3. **Before completion**: run `ruff check`, `ruff format`, type-check, and
   tests. Remove debug artefacts: `debug-*.py`, ad-hoc `test-*.py` scripts,
   `__pycache__/`, stray print statements.
4. **Don't over-engineer**: choose patterns for this context, not the
   fanciest available. Favour realistic, maintainable solutions.

## Reference Index

| Load when the task involves... | File |
|---|---|
| Idioms: comprehensions, generators, context managers, dataclasses, decorators, pattern matching | [references/idioms.md](references/idioms.md) |
| Type annotations beyond basics: Protocol, TypedDict, TypeVar, ParamSpec, variance | [references/type-system.md](references/type-system.md) |
| Exception design, logging setup | [references/errors-and-logging.md](references/errors-and-logging.md) |
| Writing or fixing tests | [references/testing.md](references/testing.md) |
| asyncio, threads, multiprocessing | [refere