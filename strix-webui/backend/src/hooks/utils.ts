#!/usr/bin/env node
import { appendFileSync, mkdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import type { InternalEvent, TruncatedOutput } from "@strix-webui/shared";

export const LARGE_OUTPUT_CONFIG = {
  MAX_OUTPUT_SIZE: 10000,
  TRUNCATED_PREVIEW_SIZE: 1000,
};

const DATA_DIR = join(homedir(), ".strix-webui");

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export function writeEvent(event: InternalEvent): void {
  const eventDir = join(DATA_DIR, "events");
  const eventFile = join(eventDir, "events.jsonl");

  if (!existsSync(eventDir)) {
    mkdirSync(eventDir, { recursive: true });
  }

  appendFileSync(eventFile, JSON.stringify(event) + "\n");
}

function saveFullContent(content: unknown): string {
  const contentDir = join(DATA_DIR, "content");
  if (!existsSync(contentDir)) {
    mkdirSync(contentDir, { recursive: true });
  }

  const contentId = randomUUID();
  const filePath = join(contentDir, `${contentId}.json`);
  writeFileSync(filePath, JSON.stringify(content), "utf-8");

  return contentId;
}

export function truncateOutputIfNeeded(output: unknown): unknown {
  if (output === undefined || output === null) {
    return output;
  }

  const serialized = JSON.stringify(output);

  if (serialized.length <= LARGE_OUTPUT_CONFIG.MAX_OUTPUT_SIZE) {
    return output;
  }

  const contentId = saveFullContent(output);

  let preview: string;
  if (typeof output === "string") {
    preview = output.slice(0, LARGE_OUTPUT_CONFIG.TRUNCATED_PREVIEW_SIZE);
  } else {
    preview = serialized.slice(0, LARGE_OUTPUT_CONFIG.TRUNCATED_PREVIEW_SIZE);
  }

  const truncatedOutput: TruncatedOutput = {
    __truncated: true,
    __contentId: contentId,
    __originalSize: serialized.length,
    __preview: preview + (serialized.length > LARGE_OUTPUT_CONFIG.TRUNCATED_PREVIEW_SIZE ? "..." : ""),
  };

  return truncatedOutput;
}
