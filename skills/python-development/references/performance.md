# Performance

**Profile first. Optimise real bottlenecks, not guesses.** Clarity first;
optimise hot paths only; benchmark before and after.

## Profiling Toolkit

```bash
# CPU — built-in
python -m cProfile -o output.prof script.py
python -m pstats output.prof          # then: sort cumtime / stats 10

# Line-by-line (pip install line-profiler)
kernprof -l -v script.py              # @profile-decorated functions

# Memory (pip install memory-profiler)
python -m memory_profiler script.py

# Production / live process (pip install py-spy) — no code changes needed
py-spy top --pid 12345
py-spy record -o profile.svg -- python script.py   # flamegraph
```

```python
# Micro-benchmarks: timeit, never time.time() in a loop
import timeit
timeit.timeit("sum(range(1000000))", number=100)

# Memory leak hunting
import tracemalloc
tracemalloc.start()
snapshot1 = tracemalloc.take_snapshot()
run_workload()
snapshot2 = tracemalloc.take_snapshot()
for stat in snapshot2.compare_to(snapshot1, "lineno")[:10]:
    print(stat)
```

## Data Structure Selection

| Need | Use | Why |
|---|---|---|
| Membership / lookup | `set` / `dict` | O(1) vs O(n) list scan |
| Queue (both ends) | `collections.deque` | O(1) appends/pops |
| Counting | `collections.Counter` | C-implemented |
| Numerical arrays | NumPy | vectorised, orders of magnitude faster |

## Core Optimisation Patterns

```python
# Generators for large data — constant memory
total = sum(x * x for x in range(1_000_000))
for line in f:                       # not f.readlines()
    ...

# Memoisation
from functools import cache, lru_cache
@cache                               # unbounded
def expensive(n): ...
@lru_cache(maxsize=1024)             # bounded
def lookup(key): ...

# join, not += for strings (O(n) vs O(n²))
result = "".join(str(item) for item in items)

# __slots__ / @dataclass(slots=True) when creating many instances

# Comprehensions and built-ins over manual loops (C-implemented)
# In genuinely hot loops: bind globals/attributes to locals first;
# function call overhead matters — but only after profiling proves it
```

## I/O and Database

- **Batch operations**: `executemany` + single commit, not per-row commits.
- Connection pooling for databases.
- Eager loading to kill N+1 queries (`select_related`, `prefetch_related`,
  SQLAlchemy `selectinload`).
- Index frequently queried columns; check with `EXPLAIN QUERY PLAN`;
  select only needed columns.
- Async I/O or threads for concurrent I/O-bound work; multiprocessing for
  CPU-bound (see async-concurrency.md).

## Caches and Memory

- `weakref.WeakValueDictionary` for caches that shouldn't block garbage
  collection.
- Watch for unintended references keeping large objects alive (lists that
  only grow, module-level caches).

## Escalation Path

If pure-Python optimisation isn't enough: NumPy (numerical), Cython or
native extensions (hot loops), PyPy (long-running pure-Python workloads).

## Pitfalls

Optimising without profiling; over-optimising rare paths; unnecessary
copies of large data; ignoring algorithmic complexity while micro-tuning.

## Regression Guarding

`pytest-benchmark` for performance-sensitive code:
`pytest test_perf.py --benchmark-compare`.
