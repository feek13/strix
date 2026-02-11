use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use notify::{EventKind, RecursiveMode, Watcher};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

use crate::models::InternalEvent;
use crate::store::AppDb;

const POLL_INTERVAL_MS: u64 = 500;

/// Wraps an InternalEvent with a replay flag.
/// During replay, `is_replay = true` so handlers skip side effects (e.g. duplicate logs).
#[derive(Debug, Clone)]
pub struct EventWithReplay {
    pub event: InternalEvent,
    pub is_replay: bool,
}

/// Watches `~/.strix-webui/events/events.jsonl` for new events,
/// parses them, and broadcasts via a tokio broadcast channel.
/// Direct port of `event-receiver.ts`.
pub struct EventReceiver {
    event_dir: PathBuf,
    event_file: PathBuf,
    cursor_file: PathBuf,
    tx: broadcast::Sender<EventWithReplay>,
    /// Shared flag to signal the background tasks to stop.
    running: Arc<AtomicBool>,
    poll_handle: Option<JoinHandle<()>>,
    watcher: Option<Box<dyn Watcher + Send>>,
}

impl EventReceiver {
    pub fn new() -> (Self, broadcast::Receiver<EventWithReplay>) {
        let data_dir = AppDb::data_dir();
        let event_dir = data_dir.join("events");
        let event_file = event_dir.join("events.jsonl");
        let cursor_file = event_dir.join(".cursor");

        // Channel with generous buffer — events are small
        let (tx, rx) = broadcast::channel(4096);

        let receiver = Self {
            event_dir,
            event_file,
            cursor_file,
            tx,
            running: Arc::new(AtomicBool::new(false)),
            poll_handle: None,
            watcher: None,
        };
        (receiver, rx)
    }

    pub fn sender(&self) -> broadcast::Sender<EventWithReplay> {
        self.tx.clone()
    }

    /// Start watching for events. Handles cursor resume/replay logic.
    pub fn start(&mut self) {
        fs::create_dir_all(&self.event_dir).ok();
        self.running.store(true, Ordering::SeqCst);

        let saved_cursor = self.load_cursor();

        if self.event_file.exists() {
            let file_size = fs::metadata(&self.event_file)
                .map(|m| m.len())
                .unwrap_or(0);

            if saved_cursor > 0 && saved_cursor <= file_size {
                // Resume from persisted position
                tracing::info!(
                    "[EventReceiver] Resuming from cursor {} ({} bytes unprocessed)",
                    saved_cursor,
                    file_size - saved_cursor
                );
                if saved_cursor < file_size {
                    self.read_new_events(saved_cursor);
                } else {
                    // Save the current position for polling
                    self.save_cursor(saved_cursor);
                }
            } else if saved_cursor > file_size {
                // File was truncated — replay all
                tracing::info!(
                    "[EventReceiver] File truncated (cursor={}, size={}), replaying all",
                    saved_cursor,
                    file_size
                );
                self.replay_all_events();
            } else {
                // No cursor (first run) — replay all
                tracing::info!("[EventReceiver] No cursor found, replaying all events");
                self.replay_all_events();
            }
        }

        // Set up fs watcher via notify
        self.start_watcher();

        // Set up poll timer as fallback
        self.start_poll_timer();

        tracing::info!("[EventReceiver] Watching {:?}", self.event_file);
    }

    fn start_watcher(&mut self) {
        let event_file = self.event_file.clone();
        let tx = self.tx.clone();
        let cursor_file = self.cursor_file.clone();
        let running = self.running.clone();

        // Use a channel-based approach: notify sends to a std channel,
        // we spawn a tokio task to read from it
        let (notify_tx, notify_rx) = std::sync::mpsc::channel();

        let watcher_result = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = notify_tx.send(event);
            }
        });

        match watcher_result {
            Ok(mut watcher) => {
                if let Err(e) = watcher.watch(&self.event_dir, RecursiveMode::NonRecursive) {
                    tracing::warn!("[EventReceiver] fs.watch failed: {}, relying on polling", e);
                } else {
                    // Spawn a task to process notify events
                    let event_file2 = event_file.clone();
                    let tx2 = tx.clone();
                    let cursor_file2 = cursor_file.clone();
                    let running2 = running.clone();

                    tokio::spawn(async move {
                        loop {
                            if !running2.load(Ordering::SeqCst) {
                                break;
                            }
                            // Non-blocking check with timeout
                            match notify_rx.recv_timeout(Duration::from_millis(200)) {
                                Ok(event) => {
                                    let is_our_file = event.paths.iter().any(|p| {
                                        p.file_name()
                                            .map(|n| n == "events.jsonl")
                                            .unwrap_or(false)
                                    });
                                    if is_our_file
                                        && matches!(
                                            event.kind,
                                            EventKind::Modify(_) | EventKind::Create(_)
                                        )
                                    {
                                        read_new_events_static(
                                            &event_file2,
                                            &cursor_file2,
                                            &tx2,
                                            false,
                                        );
                                    }
                                }
                                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                            }
                        }
                    });

                    self.watcher = Some(Box::new(watcher));
                }
            }
            Err(e) => {
                tracing::warn!("[EventReceiver] fs.watch failed: {}, relying on polling", e);
            }
        }
    }

    fn start_poll_timer(&mut self) {
        let event_file = self.event_file.clone();
        let cursor_file = self.cursor_file.clone();
        let tx = self.tx.clone();
        let running = self.running.clone();

        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(POLL_INTERVAL_MS));
            loop {
                interval.tick().await;
                if !running.load(Ordering::SeqCst) {
                    break;
                }
                if !event_file.exists() {
                    continue;
                }
                // Check if file has grown
                let current_cursor = load_cursor_static(&cursor_file);
                let file_size = fs::metadata(&event_file)
                    .map(|m| m.len())
                    .unwrap_or(0);
                if file_size > current_cursor {
                    read_new_events_static(&event_file, &cursor_file, &tx, false);
                }
            }
        });
        self.poll_handle = Some(handle);
    }

    /// Replay all events from the beginning, marking each with `is_replay = true`.
    fn replay_all_events(&self) {
        if !self.event_file.exists() {
            return;
        }

        let mut count = 0u64;
        if let Ok(file) = fs::File::open(&self.event_file) {
            let reader = BufReader::new(file);
            for line in reader.lines() {
                let Ok(line) = line else { continue };
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<InternalEvent>(&line) {
                    Ok(event) => {
                        let _ = self.tx.send(EventWithReplay {
                            event,
                            is_replay: true,
                        });
                        count += 1;
                    }
                    Err(_) => {
                        // Skip malformed lines
                    }
                }
            }
        }

        let file_size = fs::metadata(&self.event_file)
            .map(|m| m.len())
            .unwrap_or(0);
        self.save_cursor(file_size);
        tracing::info!("[EventReceiver] Replayed {} events", count);
    }

    /// Read new events from the cursor position onward.
    fn read_new_events(&self, from_position: u64) {
        read_new_events_from(
            &self.event_file,
            &self.cursor_file,
            &self.tx,
            from_position,
            false,
        );
    }

    /// Clear the events file and reset cursor.
    pub fn clear_events(&self) {
        fs::write(&self.event_file, "").ok();
        self.save_cursor(0);
        tracing::info!("[EventReceiver] Events file cleared");
    }

    /// Stop watching and persist cursor.
    pub fn stop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        // Persist cursor
        let cursor = load_cursor_static(&self.cursor_file);
        save_cursor_static(&self.cursor_file, cursor);

        // Drop watcher
        self.watcher = None;

        // Abort poll task
        if let Some(handle) = self.poll_handle.take() {
            handle.abort();
        }

        tracing::info!("[EventReceiver] Stopped");
    }

    fn load_cursor(&self) -> u64 {
        load_cursor_static(&self.cursor_file)
    }

    fn save_cursor(&self, position: u64) {
        save_cursor_static(&self.cursor_file, position);
    }
}

// --- Static helpers (used by spawned tasks without &self) ---

fn load_cursor_static(cursor_file: &PathBuf) -> u64 {
    fs::read_to_string(cursor_file)
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0)
}

fn save_cursor_static(cursor_file: &PathBuf, position: u64) {
    fs::write(cursor_file, position.to_string()).ok();
}

/// Read new events starting from the persisted cursor position.
fn read_new_events_static(
    event_file: &PathBuf,
    cursor_file: &PathBuf,
    tx: &broadcast::Sender<EventWithReplay>,
    is_replay: bool,
) {
    let from = load_cursor_static(cursor_file);
    read_new_events_from(event_file, cursor_file, tx, from, is_replay);
}

/// Read new events from a specific byte position.
fn read_new_events_from(
    event_file: &PathBuf,
    cursor_file: &PathBuf,
    tx: &broadcast::Sender<EventWithReplay>,
    from_position: u64,
    is_replay: bool,
) {
    let Ok(mut file) = fs::File::open(event_file) else {
        return;
    };
    let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);

    let mut from = from_position;

    // Handle file truncation
    if file_size < from {
        from = 0;
    }

    if file_size <= from {
        return;
    }

    if file.seek(SeekFrom::Start(from)).is_err() {
        return;
    }

    let reader = BufReader::new(file);
    for line in reader.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<InternalEvent>(&line) {
            Ok(event) => {
                let _ = tx.send(EventWithReplay { event, is_replay });
            }
            Err(_) => {
                // Skip malformed lines
            }
        }
    }

    save_cursor_static(cursor_file, file_size);
}
