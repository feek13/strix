"""Docker container management for sandboxes."""

import asyncio
import secrets
from typing import Any

import docker
from docker.errors import DockerException, NotFound

from strix_sandbox.runtime.state import SandboxState, state_manager


class DockerManager:
    """Manages Docker containers for sandbox environments."""

    IMAGE_NAME = "strix/sandbox-mcp:latest"
    CONTAINER_PREFIX = "strix-sandbox-"

    def __init__(self) -> None:
        self._client: docker.DockerClient | None = None

    @property
    def client(self) -> docker.DockerClient:
        """Get or create Docker client."""
        if self._client is None:
            try:
                self._client = docker.from_env()
            except DockerException as e:
                raise RuntimeError(f"Failed to connect to Docker: {e}") from e
        return self._client

    async def create_sandbox(
        self,
        sandbox_id: str,
        with_proxy: bool = True,
        with_browser: bool = True,
        workspace_path: str | None = None,
    ) -> SandboxState:
        """Create a new sandbox container."""
        # Create state
        state = state_manager.create(sandbox_id)

        # Generate secure token for tool server
        state.tool_server_token = secrets.token_urlsafe(32)

        # Container configuration
        container_name = f"{self.CONTAINER_PREFIX}{sandbox_id}"
        environment = {
            "TOOL_SERVER_TOKEN": state.tool_server_token,
            "WITH_PROXY": str(with_proxy).lower(),
            "WITH_BROWSER": str(with_browser).lower(),
        }

        # Port bindings - dynamically allocate ports
        ports = {"9999/tcp": None}  # Tool server
        if with_proxy:
            ports["8080/tcp"] = None  # mitmproxy

        # Volumes
        volumes = {}
        if workspace_path:
            volumes[workspace_path] = {"bind": "/workspace", "mode": "rw"}

        try:
            # Run container in background
            container = await asyncio.to_thread(
                self.client.containers.run,
                self.IMAGE_NAME,
                name=container_name,
                detach=True,
                ports=ports,
                environment=environment,
                volumes=volumes,
                cap_add=["SYS_ADMIN"],
                security_opt=["seccomp:unconfined"],
                remove=True,  # Auto-remove when stopped
            )

            state.container_id = container.id
            state.status = "starting"

            # Wait for container to be running and get assigned ports
            await self._wait_for_container(state)

            state.status = "running"
            return state

        except DockerException as e:
            state.status = "error"
            state.metadata["error"] = str(e)
            raise RuntimeError(f"Failed to create sandbox: {e}") from e

    async def _wait_for_container(self, state: SandboxState, timeout: int = 30) -> None:
        """Wait for container to be ready."""
        container_id = state.container_id
        if not container_id:
            raise RuntimeError("No container ID")

        for _ in range(timeout):
            try:
                container = await asyncio.to_thread(
                    self.client.containers.get, container_id
                )
                if container.status == "running":
                    # Get assigned ports
                    container.reload()
                    ports = container.attrs.get("NetworkSettings", {}).get("Ports", {})

                    # Tool server port
                    tool_port_info = ports.get("9999/tcp")
                    if tool_port_info:
                        state.tool_server_port = int(tool_port_info[0]["HostPort"])

                    # Proxy port
                    proxy_port_info = ports.get("8080/tcp")
                    if proxy_port_info:
                        state.proxy_port = int(proxy_port_info[0]["HostPort"])

                    return

            except (NotFound, DockerException):
                pass

            await asyncio.sleep(1)

        raise TimeoutError(f"Container {container_id} did not start in time")

    async def destroy_sandbox(self, sandbox_id: str) -> bool:
        """Destroy a sandbox container."""
        state = state_manager.get(sandbox_id)
        if not state:
            return False

        if state.container_id:
            try:
                container = await asyncio.to_thread(
                    self.client.containers.get, state.container_id
                )
                await asyncio.to_thread(container.stop, timeout=10)
            except NotFound:
                pass  # Container already removed
            except DockerException as e:
                # Log but continue with cleanup
                state.metadata["cleanup_error"] = str(e)

        state_manager.delete(sandbox_id)
        return True

    async def get_sandbox_status(self, sandbox_id: str) -> dict[str, Any]:
        """Get status of a sandbox."""
        state = state_manager.get(sandbox_id)
        if not state:
            return {"status": "not_found"}

        result = state.to_dict()

        if state.container_id:
            try:
                container = await asyncio.to_thread(
                    self.client.containers.get, state.container_id
                )
                container.reload()
                result["container_status"] = container.status
                result["stats"] = self._get_container_stats(container)
            except NotFound:
                result["container_status"] = "removed"
                state.status = "stopped"
            except DockerException:
                result["container_status"] = "unknown"

        return result

    def _get_container_stats(self, container: Any) -> dict[str, Any]:
        """Get container resource usage stats."""
        try:
            stats = container.stats(stream=False)
            cpu_delta = stats["cpu_stats"]["cpu_usage"]["total_usage"] - stats[
                "precpu_stats"
            ]["cpu_usage"]["total_usage"]
            system_delta = stats["cpu_stats"]["system_cpu_usage"] - stats[
                "precpu_stats"
            ]["system_cpu_usage"]
            cpu_percent = (cpu_delta / system_delta) * 100 if system_delta > 0 else 0

            memory_usage = stats["memory_stats"].get("usage", 0)
            memory_limit = stats["memory_stats"].get("limit", 1)
            memory_percent = (memory_usage / memory_limit) * 100

            return {
                "cpu_percent": round(cpu_percent, 2),
                "memory_mb": round(memory_usage / 1024 / 1024, 2),
                "memory_percent": round(memory_percent, 2),
            }
        except (KeyError, ZeroDivisionError):
            return {}

    async def execute_in_sandbox(
        self, sandbox_id: str, tool_name: str, args: dict[str, Any]
    ) -> dict[str, Any]:
        """Execute a tool in the sandbox container via HTTP."""
        import httpx

        state = state_manager.get_or_raise(sandbox_id)

        if state.status != "running":
            raise RuntimeError(f"Sandbox {sandbox_id} is not running")

        url = f"http://localhost:{state.tool_server_port}/execute"
        headers = {"Authorization": f"Bearer {state.tool_server_token}"}

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                url,
                json={"tool_name": tool_name, "args": args},
                headers=headers,
            )
            response.raise_for_status()
            return response.json()


# Global Docker manager instance
docker_manager = DockerManager()
