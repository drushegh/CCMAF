# Idiomatic Python Patterns

Imports assumed throughout (always from `collections.abc`, not `typing`):

```python
from collections.abc import Callable, Iterable, Iterator
import time
```

## Comprehensions and Generators

```python
# List comprehension for simple transformations
names = [user.name for user in users if user.is_active]

# Too complex for a comprehension? Use a plain function instead
def filter_and_transform(items: Iterable[int]) -> list[int]:
    result = []
    for x in items:
        if x > 0 and x % 2 == 0:
            result.append(x * 2)
    return result

# Generator expression — lazy, constant memory
total = sum(x * x for x in range(1_000_000))   # not sum([...])

# Generator function for streaming large data
def read_large_file(path: str) -> Iterator[str]:
    with open(path) as f:
        for line in f:
            yield line.strip()
```

## Context Managers

```python
# Always use `with` for resources (files, locks, connections)
with open(path) as f:
    data = f.read()

# Custom: @contextmanager for simple cases
from contextlib import contextmanager

@contextmanager
def timer(name: str):
    start = time.perf_counter()
    try:
        yield
    finally:
        print(f"{name} took {time.perf_counter() - start:.4f}s")

# Class-based when you need state / conditional cleanup
class DatabaseTransaction:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        self.connection.begin_transaction()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is None:
            self.connection.commit()
        else:
            self.connection.rollback()
        return False  # don't suppress exceptions
```

## Dataclasses and NamedTuples

```python
from dataclasses import dataclass, field
from datetime import datetime, timezone

@dataclass(slots=True)              # slots=True: less memory, faster access
class User:
    id: str
    name: str
    email: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    tags: list[str] = field(default_factory=list)   # never a mutable literal

    def __post_init__(self) -> None:                # lightweight validation
        if "@" not in self.email:
            raise ValueError(f"Invalid email: {self.email}")

# NamedTuple for small immutable value types
from typing import NamedTuple

class Point(NamedTuple):
    x: float
    y: float
```

Use a dataclass for mutable entities, `NamedTuple`/`frozen=True` for value
objects, and Pydantic when you need runtime validation of external data.

## Decorators

```python
import functools

def timer(func: Callable) -> Callable:
    @functools.wraps(func)                 # always preserve metadata
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        print(f"{func.__name__} took {time.perf_counter() - start:.4f}s")
        return result
    return wrapper

# Parameterised decorator: one extra nesting level
def repeat(times: int):
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            return [func(*args, **kwargs) for _ in range(times)]
        return wrapper
    return decorator

# Class-based when the decorator needs state
class CountCalls:
    def __init__(self, func: Callable):
        functools.update_wrapper(self, func)
        self.func = func
        self.count = 0

    def __call__(self, *args, **kwargs):
        self.count += 1
        return self.func(*args, **kwargs)
```

## Pattern Matching (3.10+)

```python
match response.status:
    case 200:
        return response.json()
    case 404:
        raise NotFoundError()
    case _:
        raise APIError(response.status)
```

## EAFP

```python
# Preferred
try:
    return dictionary[key]
except KeyError:
    return default_value

# Or simply
return dictionary.get(key, default_value)
```

## Other Preferences

- Dependency injection over singletons; `@cache` for m