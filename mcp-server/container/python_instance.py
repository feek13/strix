"""Python code execution using IPython - Container implementation."""

import logging
import sys
from io import StringIO
from typing import Any

from IPython.core.interactiveshell import InteractiveShell


logger = logging.getLogger(__name__)

MAX_OUTPUT_LENGTH = 50_000


class PythonInstance:
    """Manages an IPython execution environment."""

    def __init__(self, session_id: str = "default") -> None:
        self.session_id = session_id
        self.shell = InteractiveShell.instance()
        self.shell.colors = "NoColor"

    def execute(self, code: str, timeout: int = 30) -> dict[str, Any]:
        """Execute Python code and return the result."""
        # Capture stdout/stderr
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        sys.stdout = captured_stdout = StringIO()
        sys.stderr = captured_stderr = StringIO()

        result = None
        error = None

        try:
            # Execute the code
            exec_result = self.shell.run_cell(code, store_history=True)

            if exec_result.error_before_exec:
                error = str(exec_result.error_before_exec)
            elif exec_result.error_in_exec:
                error = str(exec_result.error_in_exec)
            else:
                result = exec_result.result

        except Exception as e:
            error = f"{type(e).__name__}: {e}"

        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr

        stdout_content = captured_stdout.getvalue()
        stderr_content = captured_stderr.getvalue()

        # Combine output
        output = ""
        if stdout_content:
            output += stdout_content
        if stderr_content:
            output += f"\n[STDERR]\n{stderr_content}"

        # Truncate if needed
        if len(output) > MAX_OUTPUT_LENGTH:
            output = output[:MAX_OUTPUT_LENGTH] + f"\n... [truncated, {len(output) - MAX_OUTPUT_LENGTH} more chars]"

        # Format result
        result_str = None
        if result is not None:
            result_str = repr(result)
            if len(result_str) > 5000:
                result_str = result_str[:5000] + "... [truncated]"

        return {
            "success": error is None,
            "output": output.strip(),
            "result": result_str,
            "error": error,
            "variables": self._get_user_variables(),
        }

    def _get_user_variables(self) -> dict[str, str]:
        """Get user-defined variables (top 20 by name)."""
        user_ns = self.shell.user_ns
        ignore = {
            "In", "Out", "_", "__", "___", "_i", "_ii", "_iii",
            "_dh", "_oh", "exit", "quit", "get_ipython",
        }

        variables = {}
        for name, value in sorted(user_ns.items()):
            if name.startswith("_") or name in ignore:
                continue
            if callable(value) and not isinstance(value, type):
                continue

            try:
                val_repr = repr(value)
                if len(val_repr) > 100:
                    val_repr = val_repr[:100] + "..."
                variables[name] = val_repr
            except Exception:
                variables[name] = "<repr failed>"

            if len(variables) >= 20:
                break

        return variables

    def reset(self) -> None:
        """Reset the IPython environment."""
        self.shell.reset(new_session=True)


# Session manager
_sessions: dict[str, PythonInstance] = {}


def get_session(session_id: str = "default") -> PythonInstance:
    """Get or create a Python session."""
    if session_id not in _sessions:
        _sessions[session_id] = PythonInstance(session_id)
    return _sessions[session_id]


def close_session(session_id: str) -> bool:
    """Close a Python session."""
    if session_id in _sessions:
        del _sessions[session_id]
        return True
    return False


def list_sessions() -> list[str]:
    """List all active sessions."""
    return list(_sessions.keys())
