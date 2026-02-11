import { watch, existsSync, mkdirSync, statSync, writeFileSync, readFileSync, createReadStream } from "fs";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";
import { createInterface } from "readline";
import type { InternalEvent } from "@strix-webui/shared";

const POLL_INTERVAL_MS = 500;

export class EventReceiver extends EventEmitter {
  private eventDir: string;
  private eventFile: string;
  private cursorFile: string;
  private lastBytePosition: number = 0;
  private lastSize: number = 0;
  private watcher: ReturnType<typeof watch> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isProcessing: boolean = false;

  constructor() {
    super();
    this.eventDir = join(homedir(), ".strix-webui", "events");
    this.eventFile = join(this.eventDir, "events.jsonl");
    this.cursorFile = join(this.eventDir, ".cursor");
  }

  start(): void {
    mkdirSync(this.eventDir, { recursive: true });

    // Load persisted cursor position
    const savedCursor = this.loadCursor();

    if (existsSync(this.eventFile)) {
      const fileSize = statSync(this.eventFile).size;

      if (savedCursor > 0 && savedCursor <= fileSize) {
        // Resume from persisted position — read only unprocessed events
        this.lastBytePosition = savedCursor;
        this.lastSize = savedCursor;
        console.log(`[EventReceiver] Resuming from cursor position ${savedCursor} (${fileSize - savedCursor} bytes unprocessed)`);
        if (savedCursor < fileSize) {
          this.readNewEvents();
        }
      } else if (savedCursor > fileSize) {
        // File was truncated/cleared since last run — start from beginning
        console.log(`[EventReceiver] File was truncated (cursor=${savedCursor}, size=${fileSize}), replaying all events`);
        this.lastBytePosition = 0;
        this.lastSize = 0;
        this.replayAllEvents();
      } else {
        // No cursor (first run) — replay all events
        console.log(`[EventReceiver] No cursor found, replaying all events from file`);
        this.replayAllEvents();
      }
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

  private loadCursor(): number {
    try {
      if (existsSync(this.cursorFile)) {
        const val = readFileSync(this.cursorFile, "utf-8").trim();
        const num = parseInt(val, 10);
        return isNaN(num) ? 0 : num;
      }
    } catch { /* ignore */ }
    return 0;
  }

  private saveCursor(position: number): void {
    try {
      writeFileSync(this.cursorFile, String(position));
    } catch { /* ignore */ }
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

  /**
   * Replay all events from the beginning of the file.
   * Used on first start or when the file was truncated.
   * Events are emitted with a "replay" flag so handlers can
   * skip side effects like duplicate log entries.
   */
  private replayAllEvents(): void {
    if (!existsSync(this.eventFile)) return;

    this.isProcessing = true;
    let loadedCount = 0;

    const fileStream = createReadStream(this.eventFile, { encoding: "utf-8" });
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as InternalEvent;
        // Mark as replay so event handlers can deduplicate
        (event as InternalEvent & { _replay?: boolean })._replay = true;
        this.emit("event", event);
        loadedCount++;
      } catch {
        // Skip malformed lines
      }
    });

    rl.on("close", () => {
      const stats = statSync(this.eventFile);
      this.lastBytePosition = stats.size;
      this.lastSize = stats.size;
      this.saveCursor(stats.size);
      this.isProcessing = false;
      console.log(`[EventReceiver] Replayed ${loadedCount} events`);
    });

    rl.on("error", () => {
      rl.close();
      fileStream.destroy();
      this.isProcessing = false;
    });
  }

  clearEvents(): void {
    writeFileSync(this.eventFile, "");
    this.lastBytePosition = 0;
    this.lastSize = 0;
    this.saveCursor(0);
    console.log("[EventReceiver] Events file cleared");
  }

  stop(): void {
    // Persist cursor before stopping
    this.saveCursor(this.lastBytePosition);
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
        this.saveCursor(stats.size);
        this.isProcessing = false;
      });

      rl.on("error", () => {
        rl.close();
        fileStream.destroy();
        this.isProcessing = false;
      });
    } catch {
      this.isProcessing = false;
    }
  }
}

export const eventReceiver = new EventReceiver();
