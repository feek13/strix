import type { Response } from "express";
import { ensureDockerReady } from "../server/docker-utils.js";
import { extractErrorMessage } from "./errors.js";

/**
 * Run Docker preflight check. Returns true if Docker is ready,
 * sends 503 response and returns false if not.
 */
export async function requireDocker(
  res: Response,
  onProgress?: (msg: string) => void
): Promise<boolean> {
  try {
    await ensureDockerReady(90_000, onProgress ?? ((msg) => console.log(`[Docker] ${msg}`)));
    return true;
  } catch (err) {
    res.status(503).json({
      error: extractErrorMessage(err, "Docker is not available"),
      code: "DOCKER_NOT_READY",
    });
    return false;
  }
}
