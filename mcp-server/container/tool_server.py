"""Tool execution server running inside the Docker container."""

import argparse
import json
import logging
import sqlite3
import subprocess
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import uvicorn
from pydantic import BaseModel

from browser_instance import get_browser
from terminal_session import get_session as get_terminal, close_session as close_terminal
from python_instance import get_session as get_python, close_session as close_python, list_sessions as list_python_sessions


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Strix Tool Server", version="1.0.0")
security = HTTPBearer()
TOKEN = ""

# Database paths
REQUESTS_DB = Path("/data/requests/requests.db")
WORKSPACE = Path("/workspace")


class ToolRequest(BaseModel):
    """Tool execution request."""
    tool_name: str
    args: dict[str, Any]


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """Verify the authentication token."""
    if credentials.credentials != TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")
    return credentials.credentials


@app.get("/health")
async def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}


@app.post("/execute")
async def execute_tool(request: ToolRequest, _: str = Depends(verify_token)) -> dict[str, Any]:
    """Execute a tool and return the result."""
    tool_name = request.tool_name
    args = request.args

    logger.info(f"Executing tool: {tool_name}")

    try:
        # Route to appropriate handler
        if tool_name.startswith("browser_"):
            return await handle_browser(tool_name, args)
        elif tool_name.startswith("terminal_"):
            return handle_terminal(tool_name, args)
        elif tool_name.startswith("python_"):
            return handle_python(tool_name, args)
        elif tool_name.startswith("proxy_"):
            return handle_proxy(tool_name, args)
        elif tool_name.startswith("file_"):
            return handle_file(tool_name, args)
        else:
            raise HTTPException(status_code=404, detail=f"Unknown tool: {tool_name}")
    except Exception as e:
        logger.exception(f"Error executing {tool_name}")
        return {"success": False, "error": str(e)}


# ==================== Browser Handlers ====================

async def handle_browser(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Handle browser tool calls."""
    browser = get_browser()

    if tool_name == "browser_launch":
        return await browser.launch(args.get("url"))
    elif tool_name == "browser_goto":
        return await browser.goto(args["url"], args.get("wait_until", "domcontentloaded"))
    elif tool_name == "browser_click":
        return await browser.click(args["coordinate"])
    elif tool_name == "browser_type":
        return await browser.type_text(args["text"])
    elif tool_name == "browser_scroll":
        return await browser.scroll(args.get("direction", "down"))
    elif tool_name == "browser_screenshot":
        return await browser.screenshot()
    elif tool_name == "browser_execute_js":
        return await browser.execute_js(args["code"])
    elif tool_name == "browser_new_tab":
        return await browser.new_tab(args.get("url"))
    elif tool_name == "browser_switch_tab":
        return await browser.switch_tab(args["tab_id"])
    elif tool_name == "browser_close_tab":
        return await browser.close_tab(args["tab_id"])
    elif tool_name == "browser_get_source":
        return await browser.view_source()
    elif tool_name == "browser_close":
        return await browser.close()
    else:
        raise HTTPException(status_code=404, detail=f"Unknown browser tool: {tool_name}")


# ==================== Terminal Handlers ====================

def handle_terminal(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Handle terminal tool calls."""
    session_id = args.get("session_id", "default")

    if tool_name == "terminal_execute":
        terminal = get_terminal(session_id)
        result = terminal.execute(
            command=args["command"],
            timeout=min(args.get("timeout", 60), 60),
        )
        return {"success": True, **result}
    elif tool_name == "terminal_send_input":
        terminal = get_terminal(session_id)
        result = terminal.execute(
            command=args["input_text"],
            is_input=True,
        )
        return {"success": True, **result}
    else:
        raise HTTPException(status_code=404, detail=f"Unknown terminal tool: {tool_name}")


# ==================== Python Handlers ====================

def handle_python(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Handle Python tool calls."""
    session_id = args.get("session_id", "default")

    if tool_name == "python_execute":
        python = get_python(session_id)
        return python.execute(
            code=args["code"],
            timeout=min(args.get("timeout", 30), 60),
        )
    elif tool_name == "python_session":
        action = args["action"]
        if action == "new":
            python = get_python(session_id)
            return {"success": True, "session_id": session_id}
        elif action == "list":
            return {"success": True, "sessions": list_python_sessions()}
        elif action == "close":
            success = close_python(session_id)
            return {"success": success}
        else:
            return {"success": False, "error": f"Unknown action: {action}"}
    else:
        raise HTTPException(status_code=404, detail=f"Unknown python tool: {tool_name}")


# ==================== Proxy Handlers ====================

def handle_proxy(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Handle proxy tool calls (mitmproxy SQLite queries)."""
    if not REQUESTS_DB.exists():
        return {"success": False, "error": "Request database not found"}

    conn = sqlite3.connect(str(REQUESTS_DB))
    conn.row_factory = sqlite3.Row

    try:
        if tool_name == "proxy_start":
            # mitmproxy is started by entrypoint.sh
            return {"success": True, "status": "running", "proxy_port": 8080}

        elif tool_name == "proxy_list_requests":
            filter_expr = args.get("filter")
            limit = args.get("limit", 50)
            sort_by = args.get("sort_by", "timestamp")
            sort_order = args.get("sort_order", "desc")

            query = "SELECT id, timestamp, method, url, host, path, status_code, response_time FROM requests"
            params: list[Any] = []

            if filter_expr:
                # Simple filter parsing
                if "contains" in filter_expr:
                    parts = filter_expr.split("contains")
                    field = parts[0].strip()
                    value = parts[1].strip().strip("'\"")
                    query += f" WHERE {field} LIKE ?"
                    params.append(f"%{value}%")
                elif "=" in filter_expr:
                    parts = filter_expr.split("=")
                    field = parts[0].strip()
                    value = parts[1].strip().strip("'\"")
                    query += f" WHERE {field} = ?"
                    params.append(value)

            query += f" ORDER BY {sort_by} {sort_order.upper()} LIMIT ?"
            params.append(limit)

            cursor = conn.execute(query, params)
            rows = cursor.fetchall()

            requests = [dict(row) for row in rows]

            # Get total count
            count_cursor = conn.execute("SELECT COUNT(*) FROM requests")
            total_count = count_cursor.fetchone()[0]

            return {
                "success": True,
                "requests": requests,
                "total_count": total_count,
                "returned_count": len(requests),
            }

        elif tool_name == "proxy_view_request":
            request_id = args["request_id"]
            part = args.get("part", "request")

            cursor = conn.execute("SELECT * FROM requests WHERE id = ?", (request_id,))
            row = cursor.fetchone()

            if not row:
                return {"success": False, "error": f"Request {request_id} not found"}

            row_dict = dict(row)

            if part == "request":
                headers = json.loads(row_dict.get("request_headers", "{}"))
                body = row_dict.get("request_body", b"")
                if isinstance(body, bytes):
                    try:
                        body = body.decode("utf-8")
                    except UnicodeDecodeError:
                        body = f"<binary data: {len(body)} bytes>"

                return {
                    "success": True,
                    "method": row_dict["method"],
                    "url": row_dict["url"],
                    "headers": headers,
                    "body": body,
                }
            else:  # response
                headers = json.loads(row_dict.get("response_headers", "{}"))
                body = row_dict.get("response_body", b"")
                if isinstance(body, bytes):
                    try:
                        body = body.decode("utf-8")
                    except UnicodeDecodeError:
                        body = f"<binary data: {len(body)} bytes>"

                # Truncate large bodies
                if len(body) > 50000:
                    body = body[:50000] + f"\n... [truncated, {len(body) - 50000} more chars]"

                return {
                    "success": True,
                    "status_code": row_dict["status_code"],
                    "headers": headers,
                    "body": body,
                    "response_time": row_dict["response_time"],
                }

        elif tool_name == "proxy_send_request":
            import httpx

            method = args["method"]
            url = args["url"]
            headers = args.get("headers", {})
            body = args.get("body", "")
            timeout = args.get("timeout", 30)

            with httpx.Client(proxy="http://localhost:8080", verify=False, timeout=timeout) as client:
                response = client.request(
                    method=method,
                    url=url,
                    headers=headers,
                    content=body if body else None,
                )

                response_body = response.text
                if len(response_body) > 50000:
                    response_body = response_body[:50000] + f"\n... [truncated]"

                return {
                    "success": True,
                    "status_code": response.status_code,
                    "headers": dict(response.headers),
                    "body": response_body,
                    "response_time": response.elapsed.total_seconds(),
                }

        elif tool_name == "proxy_repeat_request":
            request_id = args["request_id"]
            modifications = args.get("modifications", {})

            cursor = conn.execute("SELECT * FROM requests WHERE id = ?", (request_id,))
            row = cursor.fetchone()

            if not row:
                return {"success": False, "error": f"Request {request_id} not found"}

            row_dict = dict(row)

            # Apply modifications
            method = modifications.get("method", row_dict["method"])
            url = modifications.get("url", row_dict["url"])
            headers = json.loads(row_dict.get("request_headers", "{}"))
            headers.update(modifications.get("headers", {}))
            body = modifications.get("body", row_dict.get("request_body", b""))

            if isinstance(body, bytes):
                body = body.decode("utf-8", errors="replace")

            import httpx

            with httpx.Client(proxy="http://localhost:8080", verify=False, timeout=30) as client:
                response = client.request(
                    method=method,
                    url=url,
                    headers=headers,
                    content=body if body else None,
                )

                response_body = response.text
                if len(response_body) > 50000:
                    response_body = response_body[:50000] + "\n... [truncated]"

                return {
                    "success": True,
                    "status_code": response.status_code,
                    "headers": dict(response.headers),
                    "body": response_body,
                    "response_time": response.elapsed.total_seconds(),
                }

        elif tool_name == "proxy_set_scope":
            # Scope is not implemented in this simple version
            return {
                "success": True,
                "scope_config": {
                    "allowlist": args.get("allowlist", []),
                    "denylist": args.get("denylist", []),
                },
                "note": "Scope filtering is advisory only in this version",
            }

        elif tool_name == "proxy_get_sitemap":
            cursor = conn.execute(
                "SELECT DISTINCT host, path FROM requests ORDER BY host, path"
            )
            rows = cursor.fetchall()

            # Build sitemap
            sitemap: dict[str, list[str]] = {}
            for row in rows:
                host = row["host"]
                path = row["path"]
                if host not in sitemap:
                    sitemap[host] = []
                if path not in sitemap[host]:
                    sitemap[host].append(path)

            return {"success": True, "sitemap": sitemap}

        else:
            raise HTTPException(status_code=404, detail=f"Unknown proxy tool: {tool_name}")

    finally:
        conn.close()


# ==================== File Handlers ====================

def handle_file(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Handle file operation tool calls."""
    if tool_name == "file_read":
        path = WORKSPACE / args["path"]

        if not path.exists():
            return {"success": False, "error": f"File not found: {args['path']}"}

        # Ensure path is within workspace
        try:
            path.resolve().relative_to(WORKSPACE.resolve())
        except ValueError:
            return {"success": False, "error": "Path outside workspace"}

        content = path.read_text(errors="replace")
        if len(content) > 100000:
            content = content[:100000] + f"\n... [truncated, {len(content) - 100000} more chars]"

        return {
            "success": True,
            "content": content,
            "size": path.stat().st_size,
            "encoding": "utf-8",
        }

    elif tool_name == "file_write":
        path = WORKSPACE / args["path"]

        # Ensure path is within workspace
        try:
            path.resolve().relative_to(WORKSPACE.resolve())
        except ValueError:
            return {"success": False, "error": "Path outside workspace"}

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(args["content"])

        return {"success": True, "size": len(args["content"])}

    elif tool_name == "file_search":
        pattern = args["pattern"]
        search_path = args.get("path", ".")

        full_path = WORKSPACE / search_path

        # Ensure path is within workspace
        try:
            full_path.resolve().relative_to(WORKSPACE.resolve())
        except ValueError:
            return {"success": False, "error": "Path outside workspace"}

        # Use ripgrep for search
        try:
            result = subprocess.run(
                ["rg", "--json", "-n", pattern, str(full_path)],
                capture_output=True,
                text=True,
                timeout=30,
            )

            matches = []
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    if data.get("type") == "match":
                        match_data = data["data"]
                        matches.append({
                            "file": match_data["path"]["text"],
                            "line": match_data["line_number"],
                            "content": match_data["lines"]["text"].strip(),
                        })
                except json.JSONDecodeError:
                    continue

            return {"success": True, "matches": matches[:100]}  # Limit results

        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Search timed out"}
        except FileNotFoundError:
            return {"success": False, "error": "ripgrep not installed"}

    elif tool_name == "file_str_replace":
        path = WORKSPACE / args["path"]
        old_str = args["old_str"]
        new_str = args["new_str"]

        if not path.exists():
            return {"success": False, "error": f"File not found: {args['path']}"}

        # Ensure path is within workspace
        try:
            path.resolve().relative_to(WORKSPACE.resolve())
        except ValueError:
            return {"success": False, "error": "Path outside workspace"}

        content = path.read_text(errors="replace")
        count = content.count(old_str)

        if count == 0:
            return {
                "success": False,
                "error": "String not found in file",
                "hint": "Make sure old_str matches exactly, including whitespace and indentation",
            }
        if count > 1:
            return {
                "success": False,
                "error": f"String found {count} times, must be unique",
                "hint": "Include more surrounding context to make the match unique",
            }

        new_content = content.replace(old_str, new_str, 1)
        path.write_text(new_content)

        return {
            "success": True,
            "message": "Replacement made successfully",
            "replacements": 1,
        }

    elif tool_name == "file_list":
        rel_path = args.get("path", ".")
        recursive = args.get("recursive", False)

        path = WORKSPACE / rel_path

        # Ensure path is within workspace
        try:
            path.resolve().relative_to(WORKSPACE.resolve())
        except ValueError:
            return {"success": False, "error": "Path outside workspace"}

        if not path.exists():
            return {"success": False, "error": f"Directory not found: {rel_path}"}

        if not path.is_dir():
            return {"success": False, "error": f"Not a directory: {rel_path}"}

        files: list[str] = []
        directories: list[str] = []

        if recursive:
            for item in path.rglob("*"):
                rel_item = str(item.relative_to(WORKSPACE))
                if item.is_file():
                    files.append(rel_item)
                elif item.is_dir():
                    directories.append(rel_item)
        else:
            for item in path.iterdir():
                rel_item = str(item.relative_to(WORKSPACE))
                if item.is_file():
                    files.append(rel_item)
                elif item.is_dir():
                    directories.append(rel_item)

        files.sort()
        directories.sort()

        return {
            "success": True,
            "files": files,
            "directories": directories,
            "total_files": len(files),
            "total_dirs": len(directories),
        }

    elif tool_name == "file_view_range":
        path = WORKSPACE / args["path"]
        start_line = args.get("start_line")
        end_line = args.get("end_line")

        if not path.exists():
            return {"success": False, "error": f"File not found: {args['path']}"}

        # Ensure path is within workspace
        try:
            path.resolve().relative_to(WORKSPACE.resolve())
        except ValueError:
            return {"success": False, "error": "Path outside workspace"}

        lines = path.read_text(errors="replace").splitlines()
        total_lines = len(lines)

        # Handle line ranges (1-indexed)
        if start_line is None:
            start_line = 1
        if end_line is None or end_line == -1:
            end_line = total_lines

        # Clamp values
        start_line = max(1, min(start_line, total_lines))
        end_line = max(start_line, min(end_line, total_lines))

        # Convert to 0-indexed
        selected_lines = lines[start_line - 1 : end_line]

        # Add line numbers
        numbered_content = "\n".join(
            f"{i + start_line:6d}\t{line}" for i, line in enumerate(selected_lines)
        )

        # Truncate if too large
        if len(numbered_content) > 100000:
            numbered_content = numbered_content[:100000] + "\n... [truncated]"

        return {
            "success": True,
            "content": numbered_content,
            "total_lines": total_lines,
            "viewed_range": [start_line, end_line],
        }

    elif tool_name == "file_insert":
        path = WORKSPACE / args["path"]
        insert_line = args.get("insert_line", 0)
        new_str = args["new_str"]

        if not path.exists():
            return {"success": False, "error": f"File not found: {args['path']}"}

        # Ensure path is within workspace
        try:
            path.resolve().relative_to(WORKSPACE.resolve())
        except ValueError:
            return {"success": False, "error": "Path outside workspace"}

        lines = path.read_text(errors="replace").splitlines(keepends=True)

        # Normalize insert_line (0 = beginning, 1 = after first line, etc.)
        if insert_line < 0:
            insert_line = 0
        if insert_line > len(lines):
            insert_line = len(lines)

        # Insert new content
        new_lines = new_str.splitlines(keepends=True)
        # Ensure newline at end if needed
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines[-1] += "\n"

        lines[insert_line:insert_line] = new_lines
        path.write_text("".join(lines))

        return {
            "success": True,
            "message": f"Inserted {len(new_lines)} line(s) after line {insert_line}",
            "new_total_lines": len(lines),
        }

    else:
        raise HTTPException(status_code=404, detail=f"Unknown file tool: {tool_name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Strix Tool Server")
    parser.add_argument("--port", type=int, default=9999, help="Port to listen on")
    parser.add_argument("--token", required=True, help="Authentication token")
    args = parser.parse_args()

    TOKEN = args.token

    logger.info(f"Starting tool server on port {args.port}")
    uvicorn.run(app, host="0.0.0.0", port=args.port, log_level="info")
