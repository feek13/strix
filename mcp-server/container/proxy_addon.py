"""mitmproxy addon for capturing HTTP requests to SQLite."""

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from mitmproxy import http, ctx


class StrixProxy:
    """Captures HTTP traffic and stores in SQLite for later analysis."""

    def __init__(self) -> None:
        self.db_path = Path("/data/requests/requests.db")
        self._init_db()

    def _init_db(self) -> None:
        """Initialize the SQLite database."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("""
            CREATE TABLE IF NOT EXISTS requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                method TEXT NOT NULL,
                url TEXT NOT NULL,
                host TEXT NOT NULL,
                path TEXT NOT NULL,
                query TEXT,
                request_headers TEXT NOT NULL,
                request_body BLOB,
                request_body_size INTEGER,
                status_code INTEGER,
                response_headers TEXT,
                response_body BLOB,
                response_body_size INTEGER,
                response_time REAL,
                content_type TEXT,
                is_websocket INTEGER DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp DESC)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_requests_host ON requests(host)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_requests_method ON requests(method)
        """)
        conn.commit()
        conn.close()

    def _get_conn(self) -> sqlite3.Connection:
        """Get a database connection."""
        return sqlite3.connect(str(self.db_path))

    def response(self, flow: http.HTTPFlow) -> None:
        """Called when a response is received."""
        try:
            # Extract request data
            request = flow.request
            response = flow.response

            # Calculate response time
            response_time = 0.0
            if hasattr(flow, 'response') and flow.response:
                response_time = flow.response.timestamp_end - flow.request.timestamp_start

            # Determine content type
            content_type = ""
            if response and response.headers:
                content_type = response.headers.get("content-type", "")

            # Insert into database
            conn = self._get_conn()
            conn.execute(
                """
                INSERT INTO requests (
                    timestamp, method, url, host, path, query,
                    request_headers, request_body, request_body_size,
                    status_code, response_headers, response_body, response_body_size,
                    response_time, content_type, is_websocket
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.utcnow().isoformat(),
                    request.method,
                    request.pretty_url,
                    request.host,
                    request.path,
                    request.query.decode() if request.query else None,
                    json.dumps(dict(request.headers)),
                    request.content,
                    len(request.content) if request.content else 0,
                    response.status_code if response else None,
                    json.dumps(dict(response.headers)) if response else None,
                    response.content if response else None,
                    len(response.content) if response and response.content else 0,
                    response_time,
                    content_type,
                    0,  # Not a websocket
                ),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            ctx.log.error(f"Failed to save request: {e}")

    def websocket_message(self, flow: http.HTTPFlow) -> None:
        """Called for WebSocket messages."""
        # Log WebSocket traffic (simplified)
        try:
            conn = self._get_conn()
            conn.execute(
                """
                INSERT INTO requests (
                    timestamp, method, url, host, path, query,
                    request_headers, request_body, request_body_size,
                    is_websocket
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.utcnow().isoformat(),
                    "WS",
                    flow.request.pretty_url,
                    flow.request.host,
                    flow.request.path,
                    None,
                    json.dumps(dict(flow.request.headers)),
                    None,
                    0,
                    1,  # Is websocket
                ),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            ctx.log.error(f"Failed to save websocket message: {e}")


# Register the addon
addons = [StrixProxy()]
