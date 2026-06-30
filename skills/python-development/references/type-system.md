# Type System

## Modern Syntax (3.10+ baseline)

```python
def process(items: list[str], lookup: dict[str, int]) -> str | None: ...
# Not: List[str], Dict[str, int], Optional[str], Union[str, None]

# ABCs come from collections.abc, not typing (deprecated there)
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence, Awaitable
```

## What to Type

Always: function parameters, return types, class attributes, public APIs.
Skip: local variables (inference), one-off scripts, usually test bodies.

## Generics and Aliases

```python
from typing import TypeVar, Any

type JSON = dict[str, Any] | list[Any] | str | int | float | bool | None  # 3.12+
# Pre-3.12: JSON = Union[...] as a module-level alias

T = TypeVar("T")

def first(items: list[T]) -> T | None:
    return items[0] if items else None

# 3.12+ inline syntax:
def first[T](items: list[T]) -> T | None: ...
```

## Protocol — structural typing instead of Any

```python
from typing import Protocol

class Renderable(Protocol):
    def render(self) -> str: ...

def render_all(items: list[Renderable]) -> str:
    return "\n".join(item.render() for item in items)
```

## TypedDict — dicts of known shape instead of dict[str, Any]

```python
from typing import TypedDict, NotRequired

class UserPayload(TypedDict):
    id: str
    name: str
    email: NotRequired[str]
```

## Advanced

```python
from collections.abc import Callable
from typing import Self, ParamSpec
import functools

# Self for fluent interfaces
class QueryBuilder:
    def where(self, clause: str) -> Self:
        ...
        return self

# ParamSpec for decorators that preserve signatures
P = ParamSpec("P")
R = TypeVar("R")

def logged(func: Callable[P, R]) -> Callable[P, R]:
    @functools.wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        return func(*args, **kwargs)
    return wrapper
```

## Variance

`dict`/`list` are invariant; `Mapping`/`Sequence` are covariant in values.
Accept `Mapping[K, V]` / `Sequence[T]` / `Iterable[T]` in parameters when
you only read — callers can then pass subtypes freely.

## Async Typing

```python
async def fetch() -> Payload: ...        # annotate the resolved type
handler: Callable[[], Awaitable[Payload]]  # for awaitable-returning callables
```

## Rules

- **Minimise `Any`** — Protocol or TypedDict almost always fits. Comment why
  when `Any` is truly necessary.
- Common friction points: mixed-type arithmetic, SQLAlchemy column
  assi