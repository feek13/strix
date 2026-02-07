import { watch, existsSync, mkdirSync, statSync, writeFileSync, createReadStream } from "fs";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";
import { createInterface } from "readline";
import type { InternalEvent } from "@strix-webui/shared";

const MAX_EVENT_AGE_HOURS = 1;
const POLL_INTERVAL_MS = 500;

export class EventReceiver extends EventEmitter {
  private eventDir: string;
  private eventFile: string;
  private lastBytePosition: number = 0;
  private lastSize: number = 0;
  private watcher: ReturnType<typeof watch> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessing: boolean = false;

  constructor() {
    super();
    this.eventDir = join(homedir(), ".strix-webui", "events");
    this.eventFile = join(this.eventDir, "events.jsonl");
  }

  start(): void {
    mkdirSync(this.eventDir, { recursive: true });

    if (existsSync(this.eventFile)) {
      this.loadRecentEvents();
    }

    try {
      this.watcher = watch(this.eventDir, (eventType, filename) => {
        if (filename === "events.jsonl" && eventType === "change") {
          this.readNewEvents();
        }
      });
    } catch {
      console.warn("[EventReceiver] fs.watch failed, relying on polling only");
    }

    this.pollTimer = setInterval(() => {
      this.pollForChanges();
    }, POLL_INTERVAL_MS);

    console.log(`[EventReceiver] Watching ${this.eventFile}`);
  }

  private pollForChanges(): void {
    if (this.isProcessing) return;
    if (!existsSync(this.eventFile)) return;

    try {
      const stats = statSync(this.eventFile);
      if (stats.size > this.lastSize) {
        this.readNewEvents();
      }
      this.lastSize = stats.size;
    } catch {
      // File may be in use
    }
  }

  private async loadRecentEventsAsync(): Promise<void> {
    if (!existsSync(this.eventFile)) return;

    const cutoffTime = new Date(Date.now() - MAX_EVENT_AGE_HOURS * 60 * 60 * 1000).toISOString();
    let loadedCount = 0;

    return new Promise((resolve) => {
      const fileStream = createReadStream(this.eventFile, { encoding: "utf-8" });
      const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line) as InternalEvent;
          if (event.timestamp >= cutoffTime) {
            this.emit("event", event);
            loadedCount++;
          }
        } catch {
          // Skip malformed lines
        }
      });

      rl.on("close", () => {
        const stats = statSync(this.eventFile);
        this.lastBytePosition = stats.size;
        this.lastSize = stats.size;
        console.log(`[EventReceiver] Loaded ${loadedCount} recent events`);
        resolve();
      });

      rl.on("error", () => resolve());
    });
  }

  private loadRecentEvents(): void {
    this.loadRecentEventsAsync().catch((err) => {
      console.error("[EventReceiver] Failed to load recent events:", err);
    });
  }

  clearEvents(): void {
    writeFileSync(this.eventFile, "");
    this.lastBytePosition = 0;
    this.lastSize = 0;
    console.log("[EventReceiver] Events file cleared");
  }

  stop(): void {
    if (this.watcher) { this.watcher.close(); this.watcher = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  private readNewEvents(): void {
    if (this.isProcessing) return;
    if (!existsSync(this.eventFile)) return;

    this.isProcessing = true;

    try {
      const stats = statSync(this.eventFile);

      if (stats.size < this.lastBytePosition) {
        this.lastBytePosition = 0;
        this.lastSize = 0;
      }

      if (stats.size <= this.lastBytePosition) {
        this.isProcessing = false;
        return;
      }

      const fileStream = createReadStream(this.eventFile, {
        start: this.lastBytePosition,
        encoding: "utf-8",
      });

      const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line) as InternalEvent;
          this.emit("event", event);
        } catch {
          // Skip malformed events
        }
      });

      rl.on("close", () => {
        this.lastBytePosition = stats.size;
        this.lastSize = stats.size;
        this.isProcessing = false;
      });

      rl.on("error", () => {
        this.isProcessing = false;
      });
    } catch {
      this.isProcessing = false;
    }
  }
}

export const eventReceiver = new EventReceiver();
