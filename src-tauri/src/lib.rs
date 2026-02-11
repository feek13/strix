pub mod bridge;
pub mod hooks;
pub mod models;
pub mod reports;
pub mod server;
pub mod store;
pub mod utils;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::routing::get;
use axum::Router;
use tauri::Manager;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;

use crate::bridge::EventReceiver;
use crate::server::rest_api::{AppState, create_rest_router};
use crate::server::scan_manager::ScanManager;
use crate::server::websocket::{WsState, spawn_event_processor, spawn_idle_checker, ws_handler};
use crate::models::ScanStatus;
use crate::store::AppDb;

const REST_PORT: u16 = 3000;
const WS_PORT: u16 = 3001;

/// State stored in Tauri managed state for cleanup on exit.
struct BackendState {
    event_receiver: Arc<Mutex<Option<EventReceiver>>>,
    scan_manager: Arc<ScanManager>,
    app_state: Arc<AppState>,
}

/// Tauri command: return the app version from Cargo.toml.
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Tauri command: open a URL in the user's default browser.
#[tauri::command]
fn open_external_url(url: String) {
    let _ = open::that(&url);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing (logs to stdout)
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "strix=info,tower_http=info".into()),
        )
        .init();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_app_version, open_external_url])
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Spawn backend initialization asynchronously to avoid blocking
            // the Tauri event loop. The frontend handles "connecting" state
            // while waiting for the backend to come online.
            tauri::async_runtime::spawn(async move {
                match start_backend().await {
                    Ok(state) => {
                        app_handle.manage(state);
                        tracing::info!("[Strix] Backend initialized");
                    }
                    Err(e) => {
                        tracing::error!("[Strix] Backend startup failed: {}", e);
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            tracing::info!("[Strix] Application exiting, cleaning up...");

            if let Some(state) = app_handle.try_state::<BackendState>() {
                // Stop active scans
                let active_ids = state.scan_manager.get_active_scan_ids();
                for id in &active_ids {
                    tracing::info!("[Strix] Stopping active scan: {}", id);
                    state.scan_manager.stop_scan(id);
                }

                // Stop event receiver (saves cursor)
                let mut guard = state.event_receiver.lock().unwrap();
                if let Some(receiver) = guard.as_mut() {
                    receiver.stop();
                }
                drop(guard);

                // Kill active ask AI processes
                {
                    let processes = state.app_state.active_ask_processes.lock().unwrap();
                    for (_, proc) in processes.iter() {
                        tracing::info!("[Strix] Killing ask AI process pid={}", proc.pid);
                        kill_process(proc.pid);
                    }
                }

                tracing::info!("[Strix] Graceful shutdown complete");
            }
        }
    });
}

/// Kill a process by PID. Platform-specific implementation.
fn kill_process(pid: u32) {
    #[cfg(unix)]
    {
        nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(pid as i32),
            nix::sys::signal::Signal::SIGTERM,
        )
        .ok();
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .spawn();
    }
}

/// Start the full backend: DB, EventReceiver, REST (3000), WebSocket (3001).
/// Returns the BackendState for Tauri managed state.
async fn start_backend() -> anyhow::Result<BackendState> {
    tracing::info!("[Strix] Starting backend services...");

    // ── 1. Database ─────────────────────────────────────────────
    let db = AppDb::open_default()?;
    tracing::info!(
        "[Strix] Database initialized at {:?}",
        AppDb::data_dir().join("strix.db")
    );

    // ── 1b. Cleanup old content files ──────────────────────────
    cleanup_old_content_files();

    // ── 1c. WAL checkpoint timer (every hour) ───────────────────
    {
        let checkpoint_db = db.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(3600));
            interval.tick().await; // skip first immediate tick
            loop {
                interval.tick().await;
                let db = checkpoint_db.clone();
                let _ = tokio::task::spawn_blocking(move || db.checkpoint_wal()).await;
            }
        });
    }

    // ── 1d. Clear stale events file if no scans are running ────
    //
    // events.jsonl is a transport channel — all data is already in SQLite.
    // If the app was killed mid-scan, ScanCompleted events never get
    // written, so the file grows forever. Clear it on startup when safe.
    {
        let running: Vec<_> = db
            .get_all_scans()
            .unwrap_or_default()
            .into_iter()
            .filter(|s| s.status == ScanStatus::Running)
            .collect();
        if running.is_empty() {
            let event_file = AppDb::data_dir().join("events").join("events.jsonl");
            if event_file.exists() {
                let size = std::fs::metadata(&event_file)
                    .map(|m| m.len())
                    .unwrap_or(0);
                if size > 0 {
                    std::fs::write(&event_file, "").ok();
                    let cursor_file = AppDb::data_dir().join("events").join(".cursor");
                    std::fs::write(&cursor_file, "0").ok();
                    tracing::info!(
                        "[Strix] Cleared stale events file ({} bytes, no running scans)",
                        size
                    );
                }
            }
        }
    }

    // ── 2. Event Receiver ───────────────────────────────────────
    let (mut event_receiver, event_rx) = EventReceiver::new();
    let event_tx = event_receiver.sender();
    event_receiver.start();
    tracing::info!("[Strix] EventReceiver started");

    let shared_event_receiver = Arc::new(Mutex::new(Some(event_receiver)));

    // ── 3. Scan Manager ─────────────────────────────────────────
    let scan_manager = Arc::new(ScanManager::new(db.clone()));
    tracing::info!("[Strix] ScanManager ready");

    // ── 4. Install hooks ────────────────────────────────────────
    install_hooks_if_available();

    // ── 5. REST API server ──────────────────────────────────────
    let app_state = Arc::new(AppState {
        db: db.clone(),
        scan_manager: scan_manager.clone(),
        active_ask_streams: Default::default(),
        active_ask_processes: Default::default(),
    });

    let rest_router = create_rest_router(app_state.clone());

    let rest_listener = TcpListener::bind(format!("0.0.0.0:{}", REST_PORT)).await?;
    tracing::info!("[Strix] REST API listening on port {}", REST_PORT);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(rest_listener, rest_router).await {
            tracing::error!("[Strix] REST server error: {}", e);
        }
    });

    // ── 6. WebSocket server ─────────────────────────────────────
    let ws_state = Arc::new(WsState::new(
        db.clone(),
        event_tx,
        scan_manager.clone(),
        shared_event_receiver.clone(),
    ));

    // Spawn the event processor (reads from broadcast channel, updates WS clients)
    let _event_processor = spawn_event_processor(ws_state.clone(), event_rx);

    // Spawn the idle agent checker
    let _idle_checker = spawn_idle_checker(ws_state.clone());

    let ws_router = Router::new()
        .route("/", get(ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(ws_state);

    let ws_listener = TcpListener::bind(format!("0.0.0.0:{}", WS_PORT)).await?;
    tracing::info!("[Strix] WebSocket server listening on port {}", WS_PORT);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(ws_listener, ws_router).await {
            tracing::error!("[Strix] WebSocket server error: {}", e);
        }
    });

    tracing::info!("[Strix] All backend services started successfully");

    Ok(BackendState {
        event_receiver: shared_event_receiver,
        scan_manager,
        app_state,
    })
}

/// Remove content/*.json files older than 30 days.
fn cleanup_old_content_files() {
    let content_dir = AppDb::data_dir().join("content");
    if !content_dir.exists() {
        return;
    }
    let threshold = std::time::SystemTime::now() - Duration::from_secs(30 * 24 * 3600);
    let mut cleaned = 0u32;
    if let Ok(entries) = std::fs::read_dir(&content_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                if let Ok(modified) = meta.modified() {
                    if modified < threshold {
                        if std::fs::remove_file(&path).is_ok() {
                            cleaned += 1;
                        }
                    }
                }
            }
        }
    }
    if cleaned > 0 {
        tracing::info!("[Strix] Cleaned up {} old content files", cleaned);
    }
}

/// Install hook binaries if the compiled binaries exist next to the main executable.
fn install_hooks_if_available() {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    if let Some(dir) = exe_dir {
        let test_name = if cfg!(windows) {
            "strix-hook-pre-tool-use.exe"
        } else {
            "strix-hook-pre-tool-use"
        };
        let test_binary = dir.join(test_name);
        if test_binary.exists() {
            match hooks::install::install_hooks(&dir) {
                Ok(()) => tracing::info!("[Strix] Hooks installed from {:?}", dir),
                Err(e) => tracing::warn!("[Strix] Hook installation failed: {}", e),
            }
        } else {
            tracing::info!(
                "[Strix] Hook binaries not found at {:?}, skipping installation",
                dir
            );
        }
    }
}
