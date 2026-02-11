use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures::stream::SplitSink;
use futures::{SinkExt, StreamExt};
use tokio::sync::{broadcast, Mutex, RwLock};
use uuid::Uuid;

use crate::bridge::event_receiver::EventWithReplay;
use crate::models::*;
use crate::store::AppDb;

const IDLE_CHECK_INTERVAL_MS: u64 = 10_000;
const AGENT_IDLE_TIMEOUT_MS: u64 = 120_000;
const HEARTBEAT_INTERVAL_MS: u64 = 15_000;

/// Generate agent ID from a tool-use ID (last 12 alphanumeric chars).
/// Matches JS: `toolUseId.slice(-12).replace(/[^a-zA-Z0-9]/g, "")`
fn generate_agent_id_from_tool_use_id(tool_use_id: &str) -> String {
    let suffix: String = tool_use_id
        .chars()
        .rev()
        .take(12)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .filter(|c| c.is_alphanumeric())
        .collect();
    format!("agent_{}", suffix)
}

/// Generate deterministic root agent ID from session ID.
/// Matches JS: `agent_${sessionId.replace(/-/g, "").slice(0, 16)}`
fn generate_root_agent_id(session_id: &str) -> String {
    let clean: String = session_id
        .chars()
        .filter(|c| *c != '-')
        .take(16)
        .collect();
    format!("agent_{}", clean)
}

/// Shared WebSocket state, accessible from multiple connections and the event handler.
pub struct WsState {
    pub db: AppDb,
    /// Map session_id -> agent_id
    session_agent_map: RwLock<HashMap<String, String>>,
    /// Map agent_id -> last activity instant
    agent_last_activity: RwLock<HashMap<String, Instant>>,
    /// All connected client senders, keyed by a unique connection id
    clients: RwLock<HashMap<String, Arc<Mutex<SplitSink<WebSocket, Message>>>>>,
    /// Event broadcast sender (from EventReceiver). Kept for future use (e.g. injecting events).
    #[allow(dead_code)]
    event_tx: broadcast::Sender<EventWithReplay>,
}

impl WsState {
    pub fn new(db: AppDb, event_tx: broadcast::Sender<EventWithReplay>) -> Self {
        Self {
            db,
            session_agent_map: RwLock::new(HashMap::new()),
            agent_last_activity: RwLock::new(HashMap::new()),
            clients: RwLock::new(HashMap::new()),
            event_tx,
        }
    }

    /// Broadcast a WSMessage to all connected clients.
    /// Skipped during replay (caller checks is_replay).
    async fn broadcast(&self, message: &WSMessage) {
        let data = match serde_json::to_string(message) {
            Ok(d) => d,
            Err(_) => return,
        };
        let clients = self.clients.read().await;
        for (_id, sender) in clients.iter() {
            let mut sink = sender.lock().await;
            let _ = sink.send(Message::Text(data.clone().into())).await;
        }
    }

    /// Send a WSMessage to a single client.
    async fn send_to(&self, client_id: &str, message: &WSMessage) {
        let data = match serde_json::to_string(message) {
            Ok(d) => d,
            Err(_) => return,
        };
        let clients = self.clients.read().await;
        if let Some(sender) = clients.get(client_id) {
            let mut sink = sender.lock().await;
            let _ = sink.send(Message::Text(data.into())).await;
        }
    }

    async fn update_agent_activity(&self, agent_id: &str) {
        self.agent_last_activity
            .write()
            .await
            .insert(agent_id.to_string(), Instant::now());
    }

    /// Handle a single internal event. Direct port of the JS eventHandler function.
    pub async fn handle_event(&self, event_with_replay: EventWithReplay) {
        let is_replay = event_with_replay.is_replay;
        let event = event_with_replay.event;

        // Skip events not belonging to a known scan
        if let Some(scan_id) = event_scan_id(&event) {
            if !scan_id.is_empty() {
                let known = self.db.get_scan(scan_id).unwrap_or(None);
                if known.is_none() && !matches!(event, InternalEvent::ScanStarted { .. }) {
                    return;
                }
            }
        }

        match event {
            InternalEvent::ScanStarted { scan_id, .. } => {
                if let Ok(Some(scan)) = self.db.get_scan(&scan_id) {
                    if !is_replay {
                        self.broadcast(&WSMessage::ScanStarted { payload: scan }).await;
                    }
                }
            }

            InternalEvent::AgentCreating {
                scan_id,
                session_id,
                tool_use_id,
                task_input,
                timestamp,
                ..
            } => {
                let agent_id = generate_agent_id_from_tool_use_id(&tool_use_id);

                // Check if agent already exists (dedup on replay)
                if let Ok(Some(_)) = self.db.get_agent(&agent_id) {
                    self.session_agent_map
                        .write()
                        .await
                        .insert(session_id.clone(), agent_id.clone());
                    self.update_agent_activity(&agent_id).await;
                    return;
                }

                let parent_id = self
                    .session_agent_map
                    .read()
                    .await
                    .get(&session_id)
                    .cloned();

                let name = task_input
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Security Agent")
                    .to_string();
                let task = task_input
                    .get("prompt")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let agent = Agent {
                    id: agent_id.clone(),
                    scan_id: scan_id.clone(),
                    name: name.clone(),
                    parent_id,
                    status: AgentStatus::Running,
                    task,
                    created_at: timestamp.clone(),
                    finished_at: None,
                };

                self.session_agent_map
                    .write()
                    .await
                    .insert(session_id, agent_id.clone());
                self.update_agent_activity(&agent_id).await;

                let _ = self.db.save_agent(&agent);
                if !is_replay {
                    self.broadcast(&WSMessage::AgentCreated {
                        payload: agent.clone(),
                    })
                    .await;

                    let log = LogEntry {
                        id: Uuid::new_v4().to_string(),
                        scan_id,
                        agent_id: Some(agent_id),
                        level: LogLevel::Info,
                        message: format!("Agent spawned: {}", name),
                        tool_name: None,
                        timestamp,
                        details: None,
                    };
                    let _ = self.db.save_log(&log);
                    self.broadcast(&WSMessage::LogEntry { payload: log }).await;
                }
            }

            InternalEvent::AgentStopped {
                session_id,
                timestamp,
                ..
            } => {
                let agent_id = self
                    .session_agent_map
                    .read()
                    .await
                    .get(&session_id)
                    .cloned();

                if let Some(agent_id) = agent_id {
                    let _ = self.db.update_agent_status(
                        &agent_id,
                        &AgentStatus::Completed,
                        Some(&timestamp),
                    );
                    if !is_replay {
                        self.broadcast(&WSMessage::AgentStatusChanged {
                            payload: AgentStatusPayload {
                                id: agent_id.clone(),
                                status: AgentStatus::Completed,
                                finished_at: Some(timestamp),
                            },
                        })
                        .await;
                    }
                    self.session_agent_map.write().await.remove(&session_id);
                    self.agent_last_activity.write().await.remove(&agent_id);
                }
            }

            InternalEvent::ToolStarted {
                scan_id,
                session_id,
                tool_use_id,
                tool_name,
                tool_input,
                timestamp,
                ..
            } => {
                let mut agent_id = self
                    .session_agent_map
                    .read()
                    .await
                    .get(&session_id)
                    .cloned()
                    .unwrap_or_default();

                if agent_id.is_empty() {
                    // Try to find an agent without tools (heuristic from JS)
                    let all_agents = self.db.get_agents_by_scan(&scan_id).unwrap_or_default();
                    let all_tools = self.db.get_tools_by_scan(&scan_id).unwrap_or_default();

                    let agents_without_tools: Vec<&Agent> = all_agents
                        .iter()
                        .filter(|a| {
                            a.status == AgentStatus::Running
                                && a.parent_id.is_some()
                                && !all_tools.iter().any(|t| t.agent_id == a.id)
                        })
                        .collect();

                    if !agents_without_tools.is_empty() {
                        // Pick oldest
                        let oldest = agents_without_tools
                            .iter()
                            .min_by_key(|a| &a.created_at)
                            .unwrap();
                        agent_id = oldest.id.clone();
                        self.session_agent_map
                            .write()
                            .await
                            .insert(session_id.clone(), agent_id.clone());
                    } else {
                        // Create or find root agent deterministically
                        let deterministic_id = generate_root_agent_id(&session_id);

                        if let Ok(Some(_)) = self.db.get_agent(&deterministic_id) {
                            agent_id = deterministic_id;
                            self.session_agent_map
                                .write()
                                .await
                                .insert(session_id.clone(), agent_id.clone());
                        } else {
                            let root_agent = Agent {
                                id: deterministic_id.clone(),
                                scan_id: scan_id.clone(),
                                name: "Strix Scanner".into(),
                                parent_id: None,
                                status: AgentStatus::Running,
                                task: "Main security assessment".into(),
                                created_at: timestamp.clone(),
                                finished_at: None,
                            };
                            agent_id = deterministic_id;
                            self.session_agent_map
                                .write()
                                .await
                                .insert(session_id.clone(), agent_id.clone());
                            let _ = self.db.save_agent(&root_agent);
                            if !is_replay {
                                self.broadcast(&WSMessage::AgentCreated {
                                    payload: root_agent,
                                })
                                .await;
                            }
                        }
                    }
                }

                self.update_agent_activity(&agent_id).await;

                let tool_execution = ToolExecution {
                    id: tool_use_id,
                    scan_id: scan_id.clone(),
                    agent_id: agent_id.clone(),
                    session_id: session_id.clone(),
                    tool_name: tool_name.clone(),
                    tool_input,
                    tool_output: None,
                    status: ToolExecutionStatus::Running,
                    started_at: timestamp.clone(),
                    completed_at: None,
                    duration: None,
                };

                let _ = self.db.save_tool_execution(&tool_execution);
                if !is_replay {
                    self.broadcast(&WSMessage::ToolStarted {
                        payload: tool_execution,
                    })
                    .await;

                    let log = LogEntry {
                        id: Uuid::new_v4().to_string(),
                        scan_id,
                        agent_id: Some(agent_id),
                        level: LogLevel::Info,
                        message: format!("Tool started: {}", tool_name),
                        tool_name: Some(tool_name),
                        timestamp,
                        details: None,
                    };
                    let _ = self.db.save_log(&log);
                    self.broadcast(&WSMessage::LogEntry { payload: log }).await;
                }
            }

            InternalEvent::ToolCompleted {
                scan_id,
                tool_use_id,
                tool_name,
                tool_output,
                timestamp,
                ..
            } => {
                let existing = self.db.get_tool_execution(&tool_use_id).unwrap_or(None);
                if let Some(existing) = existing {
                    if !existing.agent_id.is_empty() {
                        self.update_agent_activity(&existing.agent_id).await;
                    }

                    let _ = self.db.update_tool_execution(
                        &tool_use_id,
                        Some(&ToolExecutionStatus::Completed),
                        Some(&tool_output),
                        Some(&timestamp),
                    );

                    if !is_replay {
                        if let Ok(Some(updated)) = self.db.get_tool_execution(&tool_use_id) {
                            self.broadcast(&WSMessage::ToolCompleted { payload: updated })
                                .await;
                        }

                        let log = LogEntry {
                            id: Uuid::new_v4().to_string(),
                            scan_id,
                            agent_id: Some(existing.agent_id),
                            level: LogLevel::Success,
                            message: format!("Tool completed: {}", tool_name),
                            tool_name: Some(tool_name),
                            timestamp,
                            details: None,
                        };
                        let _ = self.db.save_log(&log);
                        self.broadcast(&WSMessage::LogEntry { payload: log }).await;
                    }
                }
            }

            InternalEvent::VulnerabilityFound {
                scan_id,
                agent_id,
                vulnerability,
                timestamp,
                ..
            } => {
                let vuln = Vulnerability {
                    id: Uuid::new_v4().to_string(),
                    scan_id: scan_id.clone(),
                    agent_id: agent_id.clone(),
                    title: vulnerability.title.clone(),
                    severity: Severity::from_str(&vulnerability.severity),
                    description: vulnerability.description.clone(),
                    affected_url: vulnerability.affected_url.clone(),
                    proof_of_concept: vulnerability.proof_of_concept.clone(),
                    impact: vulnerability.impact.clone(),
                    remediation: vulnerability.remediation.clone(),
                    cvss: vulnerability.cvss,
                    references: vulnerability.references.clone(),
                    discovered_at: timestamp.clone(),
                };

                let _ = self.db.save_vulnerability(&vuln);

                // Update scan finding count
                let vulns = self.db.get_vulns_by_scan(&scan_id).unwrap_or_default();
                let _ = self.db.update_scan_findings(&scan_id, vulns.len() as i64);

                if !is_replay {
                    self.broadcast(&WSMessage::VulnerabilityFound {
                        payload: vuln.clone(),
                    })
                    .await;

                    let log = LogEntry {
                        id: Uuid::new_v4().to_string(),
                        scan_id,
                        agent_id: Some(agent_id),
                        level: LogLevel::Warning,
                        message: format!(
                            "Vulnerability found: {} ({})",
                            vuln.title,
                            vuln.severity.as_str()
                        ),
                        tool_name: None,
                        timestamp,
                        details: None,
                    };
                    let _ = self.db.save_log(&log);
                    self.broadcast(&WSMessage::LogEntry { payload: log }).await;
                }
            }

            InternalEvent::ScanCompleted {
                scan_id,
                status,
                timestamp,
                ..
            } => {
                let scan_status = ScanStatus::from_str(&status);
                let _ = self
                    .db
                    .update_scan_status(&scan_id, &scan_status, Some(&timestamp));

                if !is_replay {
                    if let Ok(Some(scan)) = self.db.get_scan(&scan_id) {
                        self.broadcast(&WSMessage::ScanUpdated {
                            payload: ScanUpdatePayload {
                                id: scan.id,
                                status: Some(scan.status),
                                completed_at: scan.completed_at,
                                findings: Some(scan.findings),
                            },
                        })
                        .await;
                    }
                }

                // Mark all running agents as completed
                let scan_agents = self.db.get_agents_by_scan(&scan_id).unwrap_or_default();
                for agent in &scan_agents {
                    if agent.status == AgentStatus::Running {
                        let _ = self.db.update_agent_status(
                            &agent.id,
                            &AgentStatus::Completed,
                            Some(&timestamp),
                        );
                        if !is_replay {
                            self.broadcast(&WSMessage::AgentStatusChanged {
                                payload: AgentStatusPayload {
                                    id: agent.id.clone(),
                                    status: AgentStatus::Completed,
                                    finished_at: Some(timestamp.clone()),
                                },
                            })
                            .await;
                        }
                        self.agent_last_activity.write().await.remove(&agent.id);
                        // Remove from session map
                        let mut map = self.session_agent_map.write().await;
                        let key = map
                            .iter()
                            .find(|(_, v)| **v == agent.id)
                            .map(|(k, _)| k.clone());
                        if let Some(key) = key {
                            map.remove(&key);
                        }
                    }
                }
            }
        }
    }

    /// Handle CLEAR_ALL: wipe DB, clear event file, broadcast empty INIT_STATE.
    pub async fn handle_clear_all(&self, event_receiver: &crate::bridge::EventReceiver) {
        let _ = self.db.clear_all();
        self.session_agent_map.write().await.clear();
        self.agent_last_activity.write().await.clear();
        event_receiver.clear_events();
        self.broadcast(&WSMessage::InitState {
            payload: InitStatePayload {
                scan: None,
                agents: vec![],
                tool_executions: vec![],
                vulnerabilities: vec![],
                logs: vec![],
            },
        })
        .await;
    }
}

/// Extract scan_id from an event, if present.
fn event_scan_id(event: &InternalEvent) -> Option<&str> {
    match event {
        InternalEvent::ScanStarted { scan_id, .. } => Some(scan_id),
        InternalEvent::AgentCreating { scan_id, .. } => Some(scan_id),
        InternalEvent::AgentStopped { .. } => None,
        InternalEvent::ToolStarted { scan_id, .. } => Some(scan_id),
        InternalEvent::ToolCompleted { scan_id, .. } => Some(scan_id),
        InternalEvent::VulnerabilityFound { scan_id, .. } => Some(scan_id),
        InternalEvent::ScanCompleted { scan_id, .. } => Some(scan_id),
    }
}

/// Axum WebSocket upgrade handler.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<WsState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, state))
}

/// Handle a single WebSocket connection.
async fn handle_ws_connection(socket: WebSocket, state: Arc<WsState>) {
    let (sender, mut receiver) = socket.split();
    let sender = Arc::new(Mutex::new(sender));
    let client_id = Uuid::new_v4().to_string();

    // Register client
    state
        .clients
        .write()
        .await
        .insert(client_id.clone(), sender.clone());
    tracing::info!("[WS] Client connected: {}", client_id);

    // Send INIT_STATE
    let init_msg = build_init_state(&state.db);
    state.send_to(&client_id, &init_msg).await;

    // Spawn heartbeat ping
    let heartbeat_sender = sender.clone();
    let heartbeat_state = state.clone();
    let heartbeat_client_id = client_id.clone();
    let heartbeat_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(HEARTBEAT_INTERVAL_MS));
        loop {
            interval.tick().await;
            let clients = heartbeat_state.clients.read().await;
            if !clients.contains_key(&heartbeat_client_id) {
                break;
            }
            drop(clients);
            let mut sink = heartbeat_sender.lock().await;
            if sink.send(Message::Ping(vec![].into())).await.is_err() {
                break;
            }
        }
    });

    // Process incoming messages
    while let Some(msg) = receiver.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(_) => break,
        };

        match msg {
            Message::Text(text) => {
                if let Ok(client_msg) = serde_json::from_str::<WSClientMessage>(&text) {
                    match client_msg {
                        WSClientMessage::Ping => {
                            let pong = WSMessage::Pong {
                                payload: PongPayload {
                                    timestamp: chrono::Utc::now().to_rfc3339(),
                                },
                            };
                            state.send_to(&client_id, &pong).await;
                        }
                        WSClientMessage::ClearAll => {
                            // Note: CLEAR_ALL needs EventReceiver access.
                            // We broadcast the empty state; the caller wires up clear_events separately.
                            let _ = state.db.clear_all();
                            state.session_agent_map.write().await.clear();
                            state.agent_last_activity.write().await.clear();
                            state
                                .broadcast(&WSMessage::InitState {
                                    payload: InitStatePayload {
                                        scan: None,
                                        agents: vec![],
                                        tool_executions: vec![],
                                        vulnerabilities: vec![],
                                        logs: vec![],
                                    },
                                })
                                .await;
                        }
                        WSClientMessage::SubscribeScan { payload } => {
                            if let Ok(Some(scan)) = state.db.get_scan(&payload.scan_id) {
                                let agents = state
                                    .db
                                    .get_agents_by_scan(&scan.id)
                                    .unwrap_or_default();
                                let tools = state
                                    .db
                                    .get_tools_by_scan(&scan.id)
                                    .unwrap_or_default();
                                let vulns = state
                                    .db
                                    .get_vulns_by_scan(&scan.id)
                                    .unwrap_or_default();
                                let logs = state
                                    .db
                                    .get_recent_logs(&scan.id, 200)
                                    .unwrap_or_default();

                                let msg = WSMessage::InitState {
                                    payload: InitStatePayload {
                                        scan: Some(scan),
                                        agents,
                                        tool_executions: tools,
                                        vulnerabilities: vulns,
                                        logs,
                                    },
                                };
                                state.send_to(&client_id, &msg).await;
                            }
                        }
                    }
                }
            }
            Message::Pong(_) => {
                // Client responded to our ping — connection is alive
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // Cleanup
    heartbeat_handle.abort();
    state.clients.write().await.remove(&client_id);
    tracing::info!("[WS] Client disconnected: {}", client_id);
}

/// Build the INIT_STATE message from current DB.
fn build_init_state(db: &AppDb) -> WSMessage {
    let scans = db.get_all_scans().unwrap_or_default();
    let active_scan = scans
        .iter()
        .find(|s| s.status == ScanStatus::Running)
        .or(scans.first())
        .cloned();

    let (agents, tools, vulns, logs) = if let Some(ref scan) = active_scan {
        (
            db.get_agents_by_scan(&scan.id).unwrap_or_default(),
            db.get_tools_by_scan(&scan.id).unwrap_or_default(),
            db.get_vulns_by_scan(&scan.id).unwrap_or_default(),
            db.get_recent_logs(&scan.id, 200).unwrap_or_default(),
        )
    } else {
        (vec![], vec![], vec![], vec![])
    };

    WSMessage::InitState {
        payload: InitStatePayload {
            scan: active_scan,
            agents,
            tool_executions: tools,
            vulnerabilities: vulns,
            logs,
        },
    }
}

/// Spawn the event processing loop: reads from broadcast channel, calls handle_event.
pub fn spawn_event_processor(
    ws_state: Arc<WsState>,
    mut event_rx: broadcast::Receiver<EventWithReplay>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok(event) => {
                    ws_state.handle_event(event).await;
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("[WS] Event processor lagged, skipped {} events", n);
                }
                Err(broadcast::error::RecvError::Closed) => {
                    tracing::info!("[WS] Event channel closed, stopping processor");
                    break;
                }
            }
        }
    })
}

/// Spawn the idle agent checker loop.
pub fn spawn_idle_checker(ws_state: Arc<WsState>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(IDLE_CHECK_INTERVAL_MS));
        loop {
            interval.tick().await;

            let now = Instant::now();
            let mut to_complete = vec![];

            {
                let activity = ws_state.agent_last_activity.read().await;
                for (agent_id, last) in activity.iter() {
                    if now.duration_since(*last).as_millis() as u64 > AGENT_IDLE_TIMEOUT_MS {
                        to_complete.push(agent_id.clone());
                    }
                }
            }

            for agent_id in to_complete {
                let agent = ws_state.db.get_agent(&agent_id).unwrap_or(None);
                if let Some(agent) = agent {
                    if agent.status == AgentStatus::Running {
                        // Check if agent has running tools
                        let tools = ws_state
                            .db
                            .get_tools_by_scan(&agent.scan_id)
                            .unwrap_or_default();
                        let has_running = tools.iter().any(|t| {
                            t.agent_id == agent_id && t.status == ToolExecutionStatus::Running
                        });
                        if has_running {
                            ws_state.update_agent_activity(&agent_id).await;
                            continue;
                        }

                        let finished_at = chrono::Utc::now().to_rfc3339();
                        let _ = ws_state.db.update_agent_status(
                            &agent_id,
                            &AgentStatus::Completed,
                            Some(&finished_at),
                        );

                        // Remove from session map
                        {
                            let mut map = ws_state.session_agent_map.write().await;
                            let key = map
                                .iter()
                                .find(|(_, v)| **v == agent_id)
                                .map(|(k, _)| k.clone());
                            if let Some(key) = key {
                                map.remove(&key);
                            }
                        }

                        ws_state
                            .broadcast(&WSMessage::AgentStatusChanged {
                                payload: AgentStatusPayload {
                                    id: agent_id.clone(),
                                    status: AgentStatus::Completed,
                                    finished_at: Some(finished_at),
                                },
                            })
                            .await;
                    }
                }

                ws_state.agent_last_activity.write().await.remove(&agent_id);
            }
        }
    })
}
