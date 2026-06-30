# Debugging

Systematic process — never patch symptoms:

```
1. Understand the error → 2. Reproduce → 3. Isolate → 4. Root cause → 5. Fix → 6. Verify
```

## 1. Read the Traceback (bottom-up)

The last line is the error; the last frame is where it happened; frames
above are the call chain.

| Error | Typical cause | First check |
|---|---|---|
| `AttributeError` | Wrong type or `None` | Print type and value |
| `KeyError` | Missing dict key | Print actual keys |
| `TypeError` | Wrong argument type | Check signature |
| `ValueError` | Right type, bad value | Validate input ranges |
| `ImportError` | Missing module/path | Check installed packages |
| `IndexError` | Out-of-bounds access | Check length |
| `FileNotFoundError` | Wrong path | Print absolute path |

## 2. Reproduce Minimally

Write the smallest snippet/test that triggers the failure with the exact
problematic input. Establish: what input triggers it, consistent or
intermittent, when it started, what changed recently.

## 3. Isolate

```python
# breakpoint() drops into pdb (n=next, s=step, c=continue, p var=print,
# w=stack, l=source, q=quit)
def problematic(x):
    breakpoint()
    ...

# Targeted prints/logging around the failure point
print(f"DEBUG: {type(data)=} {data=}")
```

For richer output: `rich.traceback.install(show_locals=True)`; `icecream`'s
`ic(x, y)` for quick variable dumps. Remove all of these before completion.

## 4. Common Root Causes

```python
# None propagation
user = get_user(user_id)            # returns None when not found
if user is None:
    raise NotFoundError(f"User {user_id} not found")

# Type mismatch — "5" + 3; add hints and convert at boundaries

# Mutable default argument — def f(target=[]) shared across calls

# Missing await — returns coroutine instead of result

# Circular imports — lazy import inside the function, or restructure
```

Also check external dependencies (API contracts, file formats, DB state)
before blaming the code.

## 5. Fix at the Root

Validate inputs early and raise specific exceptions; don't sprinkle
defensive `try/except` to mask the symptom.

```python
def process_user(user_id: int, data: dict) -> dict:
    if not isinstance(user_id, int) or user_id <= 0:
        raise ValueError(f"Invalid user_id: {user_id}")
    missing = [f for f in ("name", "email") if f not in data]
    if missing:
        raise ValueError(f"Missing required fields: {missing}")
    ...
```

## 6. Verify

Regression test reproducing the bug + test that the normal path still
works. Run the full suite. Then check for the same pattern elsewhere in the
codebase.

## Checklist

1. Read full traceback bottom-up; find the exact failing line
2. Check variable types/values at that point
3. Minimal reproduction
4. Check for `None`, type mismatches, off-by-one
5. Verify external dependencies
6. Write failing test → fix → test passes → suite passes
7. Search for similar issues elsewhere
8. Remove debug prints/breakpoints

Search the web for cryptic or library-specific errors and version
compatibility issues rather than guessing.
