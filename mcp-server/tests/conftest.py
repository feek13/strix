"""Pytest configuration and shared fixtures for strix-sandbox tests."""

import asyncio
from collections.abc import AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create an event loop for the test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def mock_sandbox_id() -> str:
    """Provide a consistent sandbox ID for tests."""
    return "test-sandbox-001"


@pytest.fixture
def mock_docker_client() -> MagicMock:
    """Mock Docker client for sandbox operations."""
    client = MagicMock()
    client.containers = MagicMock()
    client.containers.run = MagicMock(return_value=MagicMock(id="container-123"))
    client.containers.get = MagicMock()
    return client


@pytest.fixture
def mock_httpx_client() -> AsyncMock:
    """Mock httpx async client for HTTP requests."""
    client = AsyncMock()
    client.get = AsyncMock()
    client.post = AsyncMock()
    client.patch = AsyncMock()
    client.delete = AsyncMock()
    return client


@pytest.fixture
async def mock_sandbox_manager(mock_sandbox_id: str) -> AsyncGenerator[MagicMock, None]:
    """Mock sandbox manager with basic operations."""
    manager = MagicMock()
    manager.create = AsyncMock(return_value={
        "sandbox_id": mock_sandbox_id,
        "status": "running",
        "proxy_port": 8080,
        "workspace_path": "/workspace",
    })
    manager.destroy = AsyncMock(return_value={"success": True})
    manager.status = AsyncMock(return_value={
        "status": "running",
        "uptime": 3600,
        "cpu_percent": 5.0,
        "memory_mb": 256,
    })
    yield manager


@pytest.fixture
def sample_finding() -> dict:
    """Sample security finding data."""
    return {
        "title": "SQL Injection in Login Form",
        "severity": "high",
        "description": "The login form is vulnerable to SQL injection attacks.",
        "evidence": "Payload: ' OR '1'='1' -- bypasses authentication",
        "remediation": "Use parameterized queries for all database operations.",
    }


@pytest.fixture
def sample_http_request() -> dict:
    """Sample HTTP request data."""
    return {
        "method": "POST",
        "url": "https://example.com/api/login",
        "headers": {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
        "body": '{"username": "admin", "password": "test"}',
    }


@pytest.fixture
def sample_http_response() -> dict:
    """Sample HTTP response data."""
    return {
        "status_code": 200,
        "headers": {
            "Content-Type": "application/json",
            "Set-Cookie": "session=abc123; HttpOnly",
        },
        "body": '{"success": true, "token": "jwt-token-here"}',
        "response_time": 0.123,
    }


@pytest.fixture
def mock_browser_context() -> MagicMock:
    """Mock Playwright browser context."""
    page = MagicMock()
    page.goto = AsyncMock()
    page.screenshot = AsyncMock(return_value=b"fake-screenshot-data")
    page.evaluate = AsyncMock(return_value="evaluation-result")
    page.content = AsyncMock(return_value="<html><body>Test</body></html>")
    page.title = AsyncMock(return_value="Test Page")
    page.url = "https://example.com"

    context = MagicMock()
    context.new_page = AsyncMock(return_value=page)
    context.pages = [page]

    browser = MagicMock()
    browser.new_context = AsyncMock(return_value=context)
    browser.close = AsyncMock()

    return browser


@pytest.fixture
def mock_proxy_requests() -> list[dict]:
    """Sample list of proxy-captured requests."""
    return [
        {
            "id": "req-001",
            "method": "GET",
            "url": "https://example.com/",
            "status_code": 200,
            "timestamp": "2025-01-01T12:00:00Z",
        },
        {
            "id": "req-002",
            "method": "POST",
            "url": "https://example.com/api/data",
            "status_code": 201,
            "timestamp": "2025-01-01T12:00:01Z",
        },
        {
            "id": "req-003",
            "method": "GET",
            "url": "https://example.com/api/users",
            "status_code": 401,
            "timestamp": "2025-01-01T12:00:02Z",
        },
    ]


# Markers for test categorization
def pytest_configure(config: pytest.Config) -> None:
    """Configure custom pytest markers."""
    config.addinivalue_line("markers", "sandbox: tests requiring sandbox environment")
    config.addinivalue_line("markers", "browser: tests requiring browser automation")
    config.addinivalue_line("markers", "proxy: tests requiring proxy functionality")
    config.addinivalue_line("markers", "integration: integration tests (slower)")
    config.addinivalue_line("markers", "unit: fast unit tests")
