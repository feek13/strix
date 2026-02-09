import { execFile, spawn } from "child_process";
import { platform } from "os";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const SANDBOX_IMAGE = "strix/sandbox-mcp:latest";

export interface PreflightStep {
  step: number;       // 1-indexed
  totalSteps: number; // always 3
  id: string;         // "docker" | "image" | "launch"
  label: string;      // "Docker Engine" | "Sandbox Image" | "Launching Scan"
  status: "pending" | "running" | "done" | "skipped" | "error";
  detail?: string;
}

function isDockerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("docker", ["info"], { timeout: 5000 }, (error) => {
      resolve(!error);
    });
  });
}

function hasDockerImage(imageName: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("docker", ["images", "-q", imageName], { timeout: 10_000 }, (error, stdout) => {
      resolve(!error && stdout.trim().length > 0);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find the Dockerfile for the sandbox image by searching known locations.
 */
function findDockerContext(): string | null {
  // Resolve paths relative to the backend source directory
  // backend/src/server/docker-utils.ts → project root is ../../../../
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // From compiled backend/dist/server/ → ../../strix-sandbox-mcp/container
    resolve(thisDir, "..", "..", "..", "..", "strix-sandbox-mcp", "container"),
    // From source backend/src/server/ → ../../strix-sandbox-mcp/container
    resolve(thisDir, "..", "..", "..", "strix-sandbox-mcp", "container"),
    // From webui root → ../strix-sandbox-mcp/container
    resolve(thisDir, "..", "..", "strix-sandbox-mcp", "container"),
    // Published mcp-server
    resolve(thisDir, "..", "..", "..", "..", "mcp-server", "container"),
    resolve(thisDir, "..", "..", "..", "mcp-server", "container"),
  ];

  for (const dir of candidates) {
    if (existsSync(resolve(dir, "Dockerfile"))) {
      return dir;
    }
  }
  return null;
}

/**
 * Build the sandbox Docker image from the Dockerfile.
 */
function buildDockerImage(
  contextDir: string,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus || (() => {});
  return new Promise((resolve, reject) => {
    const dockerfilePath = `${contextDir}/Dockerfile`;
    log(`Building Docker image ${SANDBOX_IMAGE} from ${contextDir}...`);

    const child = spawn("docker", [
      "build", "-t", SANDBOX_IMAGE, "-f", dockerfilePath, contextDir,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let lastLine = "";
    child.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().trim().split("\n");
      const line = lines[lines.length - 1];
      // Only log meaningful step changes to avoid spam
      if (line !== lastLine && (line.startsWith("Step") || line.startsWith("#") || line.includes("--->"))) {
        log(`  ${line.slice(0, 100)}`);
        lastLine = line;
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        // Buildkit outputs progress to stderr
        const lines = text.split("\n");
        const line = lines[lines.length - 1];
        if (line !== lastLine) {
          log(`  ${line.slice(0, 100)}`);
          lastLine = line;
        }
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to run docker build: ${err.message}`));
    });

    child.on("exit", (code) => {
      if (code === 0) {
        log(`Docker image ${SANDBOX_IMAGE} built successfully.`);
        resolve();
      } else {
        reject(new Error(`Docker build failed with exit code ${code}. Check the Dockerfile at ${dockerfilePath}`));
      }
    });
  });
}

/**
 * Build the sandbox Docker image, emitting structured step detail updates.
 */
function buildDockerImageWithSteps(
  contextDir: string,
  onDetail: (detail: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const dockerfilePath = `${contextDir}/Dockerfile`;
    onDetail("Starting build...");

    const child = spawn("docker", [
      "build", "-t", SANDBOX_IMAGE, "-f", dockerfilePath, contextDir,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let lastLine = "";

    const handleLine = (line: string) => {
      if (line === lastLine) return;
      // Extract step progress from Docker build output
      const stepMatch = line.match(/^Step\s+(\d+)\/(\d+)/i) || line.match(/^#(\d+)\s/);
      if (stepMatch) {
        lastLine = line;
        if (stepMatch[2]) {
          onDetail(`Building step ${stepMatch[1]}/${stepMatch[2]}...`);
        } else {
          onDetail(`Building layer #${stepMatch[1]}...`);
        }
      } else if (line.includes("--->") || line.includes("DONE") || line.includes("CACHED")) {
        lastLine = line;
        onDetail(line.slice(0, 80));
      }
    };

    child.stdout?.on("data", (data: Buffer) => {
      for (const line of data.toString().trim().split("\n")) {
        handleLine(line.trim());
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      for (const line of data.toString().trim().split("\n")) {
        handleLine(line.trim());
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to run docker build: ${err.message}`));
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker build failed with exit code ${code}. Check the Dockerfile at ${dockerfilePath}`));
      }
    });
  });
}

/**
 * Ensure Docker is running and the sandbox image exists.
 * Auto-starts Docker if needed and builds the image if missing.
 *
 * @param timeoutMs - Maximum time to wait for Docker to start (default 90s)
 * @param onStatus  - Optional callback for progress messages
 * @throws Error if Docker/image cannot be prepared
 */
export async function ensureDockerReady(
  timeoutMs = 90_000,
  onStatus?: (msg: string) => void
): Promise<void> {
  const log = onStatus || (() => {});

  // Step 1: Ensure Docker daemon is running
  if (!(await isDockerRunning())) {
    const os = platform();
    if (os === "darwin") {
      log("Docker is not running. Starting Docker Desktop...");
      await new Promise<void>((resolve, reject) => {
        execFile("open", ["-a", "Docker"], { timeout: 10_000 }, (error) => {
          if (error) reject(new Error("Failed to start Docker Desktop. Is it installed?"));
          else resolve();
        });
      });
    } else if (os === "linux") {
      log("Docker is not running. Attempting to start Docker service...");
      await new Promise<void>((resolve, reject) => {
        execFile("systemctl", ["start", "docker"], { timeout: 10_000 }, (error) => {
          if (error) reject(new Error("Failed to start Docker service. Try: sudo systemctl start docker"));
          else resolve();
        });
      });
    } else {
      throw new Error("Docker is not running. Please start Docker Desktop manually.");
    }

    // Poll until Docker daemon is ready
    const startTime = Date.now();
    let lastLogTime = 0;
    let ready = false;
    while (Date.now() - startTime < timeoutMs) {
      await sleep(2000);
      if (await isDockerRunning()) {
        log("Docker is ready.");
        ready = true;
        break;
      }
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed - lastLogTime >= 10) {
        log(`Waiting for Docker to start... (${elapsed}s)`);
        lastLogTime = elapsed;
      }
    }
    if (!ready) {
      throw new Error(
        `Docker failed to start within ${Math.round(timeoutMs / 1000)}s. Please start Docker Desktop manually.`
      );
    }
  }

  // Step 2: Check if sandbox image exists
  if (await hasDockerImage(SANDBOX_IMAGE)) {
    return; // All good
  }

  log(`Docker image ${SANDBOX_IMAGE} not found. Looking for Dockerfile...`);

  // Step 3: Find and build the image
  const contextDir = findDockerContext();
  if (!contextDir) {
    throw new Error(
      `Docker image ${SANDBOX_IMAGE} not found and Dockerfile could not be located. ` +
      `Please build it manually: cd strix-sandbox-mcp/container && docker build -t ${SANDBOX_IMAGE} .`
    );
  }

  await buildDockerImage(contextDir, log);

  // Verify the image was built
  if (!(await hasDockerImage(SANDBOX_IMAGE))) {
    throw new Error(`Docker image ${SANDBOX_IMAGE} was not found after build. Check build output for errors.`);
  }
}

/**
 * Ensure Docker is running and the sandbox image exists, emitting structured
 * PreflightStep events for each phase. Used by the SSE scan start endpoint.
 *
 * @param onStep - Callback receiving structured step updates
 * @param timeoutMs - Maximum time to wait for Docker to start (default 90s)
 * @throws Error if Docker/image cannot be prepared
 */
export async function ensureDockerReadyWithSteps(
  onStep: (step: PreflightStep) => void,
  timeoutMs = 90_000
): Promise<void> {
  const TOTAL = 3;

  const emit = (step: number, id: string, label: string, status: PreflightStep["status"], detail?: string) => {
    onStep({ step, totalSteps: TOTAL, id, label, status, detail });
  };

  // --- Step 1: Docker Engine ---
  emit(1, "docker", "Docker Engine", "running", "Checking Docker...");

  const dockerRunning = await isDockerRunning();
  if (dockerRunning) {
    emit(1, "docker", "Docker Engine", "done");
  } else {
    const os = platform();
    if (os === "darwin") {
      emit(1, "docker", "Docker Engine", "running", "Starting Docker Desktop...");
      await new Promise<void>((resolve, reject) => {
        execFile("open", ["-a", "Docker"], { timeout: 10_000 }, (error) => {
          if (error) reject(new Error("Failed to start Docker Desktop. Is it installed?"));
          else resolve();
        });
      });
    } else if (os === "linux") {
      emit(1, "docker", "Docker Engine", "running", "Starting Docker service...");
      await new Promise<void>((resolve, reject) => {
        execFile("systemctl", ["start", "docker"], { timeout: 10_000 }, (error) => {
          if (error) reject(new Error("Failed to start Docker service. Try: sudo systemctl start docker"));
          else resolve();
        });
      });
    } else {
      throw new Error("Docker is not running. Please start Docker Desktop manually.");
    }

    // Poll until Docker daemon is ready
    const startTime = Date.now();
    let ready = false;
    while (Date.now() - startTime < timeoutMs) {
      await sleep(2000);
      if (await isDockerRunning()) {
        ready = true;
        break;
      }
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      emit(1, "docker", "Docker Engine", "running", `Waiting for Docker... (${elapsed}s)`);
    }
    if (!ready) {
      throw new Error(
        `Docker failed to start within ${Math.round(timeoutMs / 1000)}s. Please start Docker Desktop manually.`
      );
    }
    emit(1, "docker", "Docker Engine", "done");
  }

  // --- Step 2: Sandbox Image ---
  emit(2, "image", "Sandbox Image", "running", "Checking image...");

  if (await hasDockerImage(SANDBOX_IMAGE)) {
    emit(2, "image", "Sandbox Image", "done");
    return;
  }

  emit(2, "image", "Sandbox Image", "running", "Image not found, locating Dockerfile...");

  const contextDir = findDockerContext();
  if (!contextDir) {
    throw new Error(
      `Docker image ${SANDBOX_IMAGE} not found and Dockerfile could not be located. ` +
      `Please build it manually: cd strix-sandbox-mcp/container && docker build -t ${SANDBOX_IMAGE} .`
    );
  }

  await buildDockerImageWithSteps(contextDir, (detail) => {
    emit(2, "image", "Sandbox Image", "running", detail);
  });

  // Verify the image was built
  if (!(await hasDockerImage(SANDBOX_IMAGE))) {
    throw new Error(`Docker image ${SANDBOX_IMAGE} was not found after build. Check build output for errors.`);
  }

  emit(2, "image", "Sandbox Image", "done");
}
