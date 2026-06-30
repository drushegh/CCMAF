# Error Handling and Logging

## Catch Specific Exceptions, Chain Them

```python
def load_config(path: str) -> Config:
    try:
        with open(path) as f:
            return Config.from_json(f.read())
    except FileNotFoundError as e:
        raise ConfigError(f"Config file not found: {path}") from e
    except json.JSONDecodeError as e:
        raise ConfigError(f"Invalid JSON in config: {path}") from e
```

`raise ... from e` preserves the original traceback. Never bare `except:`;
never return `None` to mask a failure.

## Custom Exception Hierarchy

One base exception per application; subclass per failure category. Callers
can catch broadly (`AppError`) or precisely (`NotFoundError`).

```python
class AppError(Exception):
    """Base exception for all application errors."""

class ValidationError(AppError):
    """Input validation failed."""

class NotFoundError(AppError):
    """Requested resource does not exist."""
```

## Service-Layer Pattern (APIs)

Raise domain exceptions in services; catch and transform in exception
handlers; the client gets a consistent error shape: error code
(programmatic), message (human-readable), optional field-level details —
**never** stack traces.

```python
import logging
logger = logging.getLogger(__name__)

def fetch_user_data(user_id: int) -> dict:
    try:
        response = api_client.get(f"/users/{user_id}")
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP error fetching user {user_id}: {e}")
        raise
    except httpx.ConnectError:
        logger.error(f"Connection failed for user {user_id}")
        raise ServiceUnavailableError("API unavailable")
```

## Logging Setup

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)   # module-level logger, always __name__

logger.debug("diagnostic detail")
logger.info("normal operation")
logger.exception("failed to process")  # inside except: includes traceback
```

For production services prefer structured (JSON) logging so logs are
machine-parseable.

## Resilience Patterns

For external dependencies: retry with exponential backoff, circuit breakers
for repeatedly failing services, graceful degradation where a feature can
work without the dependency. Apply these at integration boundaries, not
scattered through business logic.
