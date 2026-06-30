# Testing

pytest only. **All network calls must be mocked** — no test may hit a real
API, database server, or the internet.

## Test Types

| Type | Purpose | Tools |
|---|---|---|
| Unit | Business logic | pytest |
| Integration | API endpoints | pytest + httpx `TestClient`/`AsyncClient` |
| E2E | Full workflows | pytest + test DB |

## Core Patterns

```python
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

# Exceptions
def test_rejects_zero_count():
    with pytest.raises(ValueError, match="count cannot be zero"):
        transform({"value": 10, "count": 0})

# Parametrisation over copy-paste
@pytest.mark.parametrize("raw,expected", [("5", 5), ("0", 0), ("-3", -3)])
def test_parse(raw, expected):
    assert parse(raw) == expected

# Mocking
@patch("myapp.services.api_client")
def test_fetch_user(mock_client):
    mock_client.get.return_value = MagicMock(
        status_code=200, json=lambda: {"id": 1}
    )
    assert fetch_user(1)["id"] == 1
```

## Async Tests

```python
import pytest
from httpx import AsyncClient, ASGITransport

# pytest-asyncio: marker not needed if asyncio_mode = "auto" in pyproject
@pytest.mark.asyncio
async def test_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/users")
        assert response.status_code == 200

# Mock async functions with AsyncMock
@patch("myapp.services.fetch_remote", new_callable=AsyncMock)
async def test_service(mock_fetch):
    mock_fetch.return_value = {"ok": True}
    ...
```

## Fixtures

Standard fixture set: `db_session` (in-memory SQLite or transactional
session with cleanup), `client` (test client), `authenticated_user`,
`sample_data`. Put shared fixtures in `conftest.py`.

```python
@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = Session(engine)
    yield session
    session.close()          # cleanup always runs
```

## Rules

- Every bug fix starts with a failing test that reproduces the bug; then
  fix; then verify it passes and the rest of the suite still does.
- Test both the failure case and that the normal path still works.
- Test names describe behaviour: `test_transform_handles_zero_count`.
- Coverage: `pytest --cov=mypackage --cov-report=term-missing` — focus on
  critical paths