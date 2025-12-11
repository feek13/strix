"""Terminal session management using tmux - Container implementation."""

import logging
import re
import time
import uuid
from pathlib import Path
from typing import Any

import libtmux


logger = logging.getLogger(__name__)


class TerminalSession:
    """Manages a tmux terminal session."""

    POLL_INTERVAL = 0.5
    HISTORY_LIMIT = 10_000
    PS1_END = "]$ "

    def __init__(self, session_id: str, work_dir: str = "/workspace") -> None:
        self.session_id = session_id
        self.work_dir = str(Path(work_dir).resolve())
        self._closed = False
        self._cwd = self.work_dir

        self.server: libtmux.Server | None = None
        self.session: libtmux.Session | None = None
        self.window: libtmux.Window | None = None
        self.pane: libtmux.Pane | None = None

        self.prev_output: str = ""
        self._initialized = False

        self.initialize()

    @property
    def PS1(self) -> str:
        return r"[STRIX_$?]$ "

    @property
    def PS1_PATTERN(self) -> str:
        return r"\[STRIX_(\d+)\]"

    def initialize(self) -> None:
        """Initialize the tmux session."""
        self.server = libtmux.Server()

        session_name = f"strix-{self.session_id}-{uuid.uuid4().hex[:8]}"
        self.session = self.server.new_session(
            session_name=session_name,
            start_directory=self.work_dir,
            kill_session=True,
            x=120,
            y=30,
        )

        self.session.set_option("history-limit", str(self.HISTORY_LIMIT))

        _initial_window = self.session.active_window
        self.window = self.session.new_window(
            window_name="bash",
            window_shell="/bin/bash",
            start_directory=self.work_dir,
        )
        self.pane = self.window.active_pane
        _initial_window.kill()

        self.pane.send_keys(f'export PROMPT_COMMAND=\'export PS1="{self.PS1}"\'; export PS2=""')
        time.sleep(0.1)
        self._clear_screen()

        self.prev_output = ""
        self._closed = False
        self._cwd = str(Path(self.work_dir).resolve())
        self._initialized = True

    def _get_pane_content(self) -> str:
        """Get current pane content."""
        if not self.pane:
            raise RuntimeError("Terminal session not properly initialized")
        return "\n".join(
            line.rstrip() for line in self.pane.cmd("capture-pane", "-J", "-pS", "-").stdout
        )

    def _clear_screen(self) -> None:
        """Clear the terminal screen."""
        if not self.pane:
            raise RuntimeError("Terminal session not properly initialized")
        self.pane.send_keys("C-l", enter=False)
        time.sleep(0.1)
        self.pane.cmd("clear-history")

    def _is_special_key(self, command: str) -> bool:
        """Check if command is a special key."""
        _command = command.strip()
        if not _command:
            return False

        # Control keys (C-c, ^c, etc.)
        if (_command.startswith("C-") or _command.startswith("^")) and len(_command) >= 2:
            return True

        # Function keys (F1-F12)
        if _command.startswith("F") and len(_command) <= 3:
            try:
                return 1 <= int(_command[1:]) <= 12
            except ValueError:
                pass

        # Navigation and special keys
        special_keys = {
            "Up", "Down", "Left", "Right", "Home", "End",
            "BSpace", "BTab", "DC", "Enter", "Escape", "IC", "Space", "Tab",
            "NPage", "PageDown", "PgDn", "PPage", "PageUp", "PgUp"
        }
        return _command in special_keys

    def _matches_ps1_metadata(self, content: str) -> list[re.Match[str]]:
        """Find PS1 patterns in content."""
        return list(re.finditer(self.PS1_PATTERN + r"\]\$ ", content))

    def _extract_exit_code(self, ps1_matches: list[re.Match[str]]) -> int | None:
        """Extract exit code from PS1 matches."""
        if not ps1_matches:
            return None
        try:
            return int(ps1_matches[-1].group(1))
        except (ValueError, IndexError):
            return None

    def _combine_outputs(self, content: str, ps1_matches: list[re.Match[str]]) -> str:
        """Combine output segments between PS1 prompts."""
        if len(ps1_matches) == 0:
            return content
        if len(ps1_matches) == 1:
            return content[ps1_matches[0].end() + 1:]

        combined = ""
        for i in range(len(ps1_matches) - 1):
            combined += content[ps1_matches[i].end() + 1: ps1_matches[i + 1].start()] + "\n"
        combined += content[ps1_matches[-1].end() + 1:]
        return combined

    def execute(
        self,
        command: str,
        is_input: bool = False,
        timeout: float = 60.0,
        no_enter: bool = False,
    ) -> dict[str, Any]:
        """Execute a command in the terminal."""
        if not self._initialized:
            raise RuntimeError("Terminal session is not initialized")

        if not self.pane:
            raise RuntimeError("Terminal session not properly initialized")

        cur_pane_output = self._get_pane_content()
        ps1_matches = self._matches_ps1_metadata(cur_pane_output)
        is_command_running = not (
            cur_pane_output.rstrip().endswith(self.PS1_END.rstrip()) or len(ps1_matches) > 0
        )

        # Handle empty command - check for running command output
        if command.strip() == "":
            if is_command_running:
                return self._wait_for_completion(timeout)
            raw_output = self._combine_outputs(cur_pane_output, ps1_matches)
            return {
                "output": raw_output.strip(),
                "status": "completed",
                "exit_code": 0,
                "working_dir": self._cwd,
            }

        # Handle input to running command
        if is_input or (self._is_special_key(command) and is_command_running):
            if not is_command_running:
                return {
                    "output": "No command is currently running.",
                    "status": "error",
                    "exit_code": None,
                    "working_dir": self._cwd,
                }

            should_add_enter = not self._is_special_key(command) and not no_enter
            self.pane.send_keys(command, enter=should_add_enter)
            time.sleep(1)

            cur_pane_output = self._get_pane_content()
            ps1_matches = self._matches_ps1_metadata(cur_pane_output)
            raw_output = self._combine_outputs(cur_pane_output, ps1_matches)

            is_still_running = not (
                cur_pane_output.rstrip().endswith(self.PS1_END.rstrip()) or len(ps1_matches) > 0
            )

            if is_still_running:
                return {
                    "output": raw_output.strip(),
                    "status": "running",
                    "exit_code": None,
                    "working_dir": self._cwd,
                }

            exit_code = self._extract_exit_code(ps1_matches)
            self._clear_screen()
            return {
                "output": raw_output.strip(),
                "status": "completed",
                "exit_code": exit_code or 0,
                "working_dir": self._cwd,
            }

        # Can't run new command while one is running
        if is_command_running:
            return {
                "output": "A command is already running. Send input or interrupt with C-c.",
                "status": "error",
                "exit_code": None,
                "working_dir": self._cwd,
            }

        # Execute new command
        return self._execute_new_command(command, timeout, no_enter)

    def _execute_new_command(self, command: str, timeout: float, no_enter: bool) -> dict[str, Any]:
        """Execute a new command."""
        if not self.pane:
            raise RuntimeError("Terminal session not properly initialized")

        initial_output = self._get_pane_content()
        initial_ps1_count = len(self._matches_ps1_metadata(initial_output))

        start_time = time.time()

        should_add_enter = not self._is_special_key(command) and not no_enter
        self.pane.send_keys(command, enter=should_add_enter)

        while True:
            cur_output = self._get_pane_content()
            ps1_matches = self._matches_ps1_metadata(cur_output)

            # Check if command completed
            if len(ps1_matches) > initial_ps1_count or cur_output.rstrip().endswith(self.PS1_END.rstrip()):
                exit_code = self._extract_exit_code(ps1_matches)
                raw_output = self._combine_outputs(cur_output, ps1_matches)

                # Remove command echo from output
                output_lines = raw_output.strip().split("\n")
                if output_lines and command.strip() in output_lines[0]:
                    output_lines = output_lines[1:]

                self._clear_screen()
                return {
                    "output": "\n".join(output_lines).strip(),
                    "status": "completed",
                    "exit_code": exit_code or 0,
                    "working_dir": self._cwd,
                }

            # Check timeout
            elapsed = time.time() - start_time
            if elapsed >= timeout:
                raw_output = self._combine_outputs(cur_output, ps1_matches)
                return {
                    "output": raw_output.strip() + f"\n[Command still running after {timeout}s]",
                    "status": "running",
                    "exit_code": None,
                    "working_dir": self._cwd,
                }

            time.sleep(self.POLL_INTERVAL)

    def _wait_for_completion(self, timeout: float) -> dict[str, Any]:
        """Wait for running command to complete."""
        start_time = time.time()

        while True:
            cur_output = self._get_pane_content()
            ps1_matches = self._matches_ps1_metadata(cur_output)

            if cur_output.rstrip().endswith(self.PS1_END.rstrip()) or len(ps1_matches) > 0:
                exit_code = self._extract_exit_code(ps1_matches)
                raw_output = self._combine_outputs(cur_output, ps1_matches)
                self._clear_screen()
                return {
                    "output": raw_output.strip(),
                    "status": "completed",
                    "exit_code": exit_code or 0,
                    "working_dir": self._cwd,
                }

            elapsed = time.time() - start_time
            if elapsed >= timeout:
                raw_output = self._combine_outputs(cur_output, ps1_matches)
                return {
                    "output": raw_output.strip() + f"\n[Command still running after {timeout}s]",
                    "status": "running",
                    "exit_code": None,
                    "working_dir": self._cwd,
                }

            time.sleep(self.POLL_INTERVAL)

    def close(self) -> None:
        """Close the terminal session."""
        if self._closed:
            return

        if self.session:
            try:
                self.session.kill()
            except Exception as e:
                logger.debug("Error closing terminal session: %s", e)

        self._closed = True
        self.server = None
        self.session = None
        self.window = None
        self.pane = None


# Session manager
_sessions: dict[str, TerminalSession] = {}


def get_session(session_id: str = "default") -> TerminalSession:
    """Get or create a terminal session."""
    if session_id not in _sessions:
        _sessions[session_id] = TerminalSession(session_id)
    return _sessions[session_id]


def close_session(session_id: str) -> bool:
    """Close a terminal session."""
    if session_id in _sessions:
        _sessions[session_id].close()
        del _sessions[session_id]
        return True
    return False
