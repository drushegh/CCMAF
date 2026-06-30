# Async and Concurrency

## Choosing the Primitive

| Workload | Use |
|---|---|
| Blocking I/O, modest concurrency | `ThreadPoolExecutor` |
| CPU-bound | `ProcessPoolExecutor` / `multiprocessing` |
| High-volume concurrent I/O | `asyncio` |

The golden rule: **I/O-bound → async; CPU-bound → processes.** Never use
blocking (sync) libraries inside async code, and never force async onto CPU
work.

## asyncio Essentials

```python
import asyncio

# Entry point
asyncio.run(main())

# Structured concurrency — prefer TaskGroup (3.11+) over gather()
async def fetch_all(urls: list[str]) -> list[str]:
    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(fetch(url)) for url in urls]
    return [t.result() for t in tasks]
# TaskGroup cancels siblings on failure and raises ExceptionGroup

# gather() when you want per-task results including exceptions
results = await asyncio.gather(*tasks, return_exceptions=True)

# Timeouts
async with asyncio.timeout(10):
    await slow_operation()

# Rate limiting
sem = asyncio.Semaphore(10)
async def limited_fetch(url: str) -> str:
    async with sem:
        return await fetch(url)
```

Handle cancellation with `try/finally` so cleanup always runs; catch
`ExceptionGroup` (`except* ValueError:`) when multiple tasks can fail.

## Async Library Selection

| Need | Library |
|---|---|
| HTTP client | httpx (or aiohttp) |
| PostgreSQL | asyncpg |
| Redis | redis-py async |
| File I/O | aiofiles |
| ORM | SQLAlchemy 2.0 async |

## Threads for Blocking I/O

```python
import concurrent.futures

def fetch_all_urls(urls: list[str]) -> dict[str, str]:
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        future_to_url = {executor.submit(fetch_url, u): u for u in urls}
        results = {}
        for future in concurrent.futures.as_completed(future_to_url):
            url = future_to_url[future]
            try:
                results[url] = future.result()
            except Exception as e:
                results[url] = f"Error: {e}"
    return results
```

Inside async code, push blocking calls to a thread:
`await asyncio.to_thread(blocking_func, arg)`.

## Processes for CPU Work

```python
def process_all(datasets: list[list[int]]) -> list[int]:
    with concurrent.futures.ProcessPoolExecutor() as executor:
        return list(executor.map(cpu_intensive, datasets))
```

## Common Async Bugs

- **Missing `await`** — silently returns a coroutine object.
- Sync DB driver or `requests` inside an async endpoint — blocks the event
  loop for everyone.
- Fire-and-forget tasks without holding a reference — may be GC'd
  mid-flight; use TaskGroup or keep references.
