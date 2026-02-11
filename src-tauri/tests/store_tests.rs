use strix::models::*;
use strix::store::AppDb;

fn make_db() -> AppDb {
    AppDb::open_memory().expect("Failed to open in-memory DB")
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

// ==================== Scan CRUD ====================

#[test]
fn test_save_and_get_scan() {
    let db = make_db();
    let scan = Scan {
        id: "scan-1".into(),
        target: "https://example.com".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Pending,
        mode: "auto".into(),
        created_at: now(),
        started_at: None,
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    let loaded = db.get_scan("scan-1").unwrap().unwrap();
    assert_eq!(loaded.id, "scan-1");
    assert_eq!(loaded.target, "https://example.com");
    assert_eq!(loaded.target_type, TargetType::Url);
    assert_eq!(loaded.status, ScanStatus::Pending);
}

#[test]
fn test_get_all_scans() {
    let db = make_db();
    for i in 0..3 {
        let scan = Scan {
            id: format!("scan-{}", i),
            target: format!("target-{}", i),
            target_type: TargetType::Url,
            status: ScanStatus::Pending,
            mode: "auto".into(),
            created_at: format!("2025-01-0{}T00:00:00Z", i + 1),
            started_at: None,
            completed_at: None,
            findings: 0,
            claude_session_id: None,
        };
        db.save_scan(&scan).unwrap();
    }
    let all = db.get_all_scans().unwrap();
    assert_eq!(all.len(), 3);
    // Should be ordered by created_at DESC
    assert_eq!(all[0].id, "scan-2");
}

#[test]
fn test_update_scan_status() {
    let db = make_db();
    let scan = Scan {
        id: "scan-s".into(),
        target: "t".into(),
        target_type: TargetType::Local,
        status: ScanStatus::Pending,
        mode: "auto".into(),
        created_at: now(),
        started_at: None,
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    let ts = now();
    db.update_scan_status("scan-s", &ScanStatus::Completed, Some(&ts)).unwrap();
    let loaded = db.get_scan("scan-s").unwrap().unwrap();
    assert_eq!(loaded.status, ScanStatus::Completed);
    assert!(loaded.completed_at.is_some());
}

#[test]
fn test_update_scan_findings() {
    let db = make_db();
    let scan = Scan {
        id: "scan-f".into(),
        target: "t".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Running,
        mode: "auto".into(),
        created_at: now(),
        started_at: Some(now()),
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    db.update_scan_findings("scan-f", 5).unwrap();
    let loaded = db.get_scan("scan-f").unwrap().unwrap();
    assert_eq!(loaded.findings, 5);
}

#[test]
fn test_update_scan_claude_session_id() {
    let db = make_db();
    let scan = Scan {
        id: "scan-c".into(),
        target: "t".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Running,
        mode: "auto".into(),
        created_at: now(),
        started_at: None,
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    db.update_scan_claude_session_id("scan-c", "session-abc").unwrap();
    let loaded = db.get_scan("scan-c").unwrap().unwrap();
    assert_eq!(loaded.claude_session_id, Some("session-abc".into()));
}

#[test]
fn test_get_nonexistent_scan() {
    let db = make_db();
    let result = db.get_scan("nope").unwrap();
    assert!(result.is_none());
}

// ==================== Agent CRUD ====================

#[test]
fn test_save_and_get_agent() {
    let db = make_db();
    // Need a scan first for FK
    let scan = Scan {
        id: "s1".into(),
        target: "t".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Running,
        mode: "auto".into(),
        created_at: now(),
        started_at: None,
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    let agent = Agent {
        id: "agent-1".into(),
        scan_id: "s1".into(),
        name: "Root Agent".into(),
        parent_id: None,
        status: AgentStatus::Running,
        task: "Security scan".into(),
        created_at: now(),
        finished_at: None,
    };
    db.save_agent(&agent).unwrap();

    let loaded = db.get_agent("agent-1").unwrap().unwrap();
    assert_eq!(loaded.name, "Root Agent");
    assert_eq!(loaded.status, AgentStatus::Running);
}

#[test]
fn test_get_agents_by_scan() {
    let db = make_db();
    let scan = Scan {
        id: "s2".into(),
        target: "t".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Running,
        mode: "auto".into(),
        created_at: now(),
        started_at: None,
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    for i in 0..3 {
        let agent = Agent {
            id: format!("a-{}", i),
            scan_id: "s2".into(),
            name: format!("Agent {}", i),
            parent_id: None,
            status: AgentStatus::Running,
            task: "t".into(),
            created_at: format!("2025-01-01T00:0{}:00Z", i),
            finished_at: None,
        };
        db.save_agent(&agent).unwrap();
    }

    let agents = db.get_agents_by_scan("s2").unwrap();
    assert_eq!(agents.len(), 3);
}

#[test]
fn test_update_agent_status() {
    let db = make_db();
    let scan = Scan {
        id: "s3".into(),
        target: "t".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Running,
        mode: "auto".into(),
        created_at: now(),
        started_at: None,
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    let agent = Agent {
        id: "a-upd".into(),
        scan_id: "s3".into(),
        name: "Agent".into(),
        parent_id: None,
        status: AgentStatus::Running,
        task: "t".into(),
        created_at: now(),
        finished_at: None,
    };
    db.save_agent(&agent).unwrap();

    let ts = now();
    db.update_agent_status("a-upd", &AgentStatus::Completed, Some(&ts)).unwrap();
    let loaded = db.get_agent("a-upd").unwrap().unwrap();
    assert_eq!(loaded.status, AgentStatus::Completed);
    assert!(loaded.finished_at.is_some());
}

// ==================== Tool Execution CRUD ====================

#[test]
fn test_save_and_get_tool_execution() {
    let db = make_db();
    let scan = Scan {
        id: "st1".into(),
        target: "t".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Running,
        mode: "auto".into(),
        created_at: now(),
        started_at: None,
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    let te = ToolExecution {
        id: "te-1".into(),
        scan_id: "st1".into(),
        agent_id: "a1".into(),
        session_id: "sess1".into(),
        tool_name: "browser_action".into(),
        tool_input: serde_json::json!({"action": "goto", "url": "https://example.com"}),
        tool_output: None,
        status: ToolExecutionStatus::Running,
        started_at: now(),
        completed_at: None,
        duration: None,
    };
    db.save_tool_execution(&te).unwrap();

    let loaded = db.get_tool_execution("te-1").unwrap().unwrap();
    assert_eq!(loaded.tool_name, "browser_action");
    assert_eq!(loaded.status, ToolExecutionStatus::Running);
}

#[test]
fn test_update_tool_execution() {
    let db = make_db();
    let scan = Scan {
        id: "st2".into(),
        target: "t".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Running,
        mode: "auto".into(),
        created_at: now(),
        started_at: None,
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    let started = "2025-01-01T00:00:00Z";
    let te = ToolExecution {
        id: "te-upd".into(),
        scan_id: "st2".into(),
        agent_id: "a1".into(),
        session_id: "sess1".into(),
        tool_name: "proxy_send_request".into(),
        tool_input: serde_json::json!({}),
        tool_output: None,
        status: ToolExecutionStatus::Running,
        started_at: started.into(),
        completed_at: None,
        duration: None,
    };
    db.save_tool_execution(&te).unwrap();

    let completed = "2025-01-01T00:00:05Z";
    let output = serde_json::json!({"status_code": 200});
    db.update_tool_execution(
        "te-upd",
        Some(&ToolExecutionStatus::Completed),
        Some(&output),
        Some(completed),
    ).unwrap();

    let loaded = db.get_tool_execution("te-upd").unwrap().unwrap();
    assert_eq!(loaded.status, ToolExecutionStatus::Completed);
    assert!(loaded.tool_output.is_some());
    assert!(loaded.duration.is_some());
    assert_eq!(loaded.duration.unwrap(), 5000.0);
}

#[test]
fn test_get_tools_by_scan() {
    let db = make_db();
    let scan = Scan {
        id: "st3".into(),
        target: "t".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Running,
        mode: "auto".into(),
        created_at: now(),
        started_at: None,
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    for i in 0..2 {
        let te = ToolExecution {
            id: format!("te-{}", i),
            scan_id: "st3".into(),
            agent_id: "a1".into(),
            session_id: "s1".into(),
            tool_name: "tool".into(),
            tool_input: serde_json::json!({}),
            tool_output: None,
            status: ToolExecutionStatus::Running,
            started_at: format!("2025-01-01T00:0{}:00Z", i),
            completed_at: None,
            duration: None,
        };
        db.save_tool_execution(&te).unwrap();
    }

    let tools = db.get_tools_by_scan("st3").unwrap();
    assert_eq!(tools.len(), 2);
}

// ==================== Vulnerability CRUD ====================

#[test]
fn test_save_and_get_vulnerability() {
    let db = make_db();
    let scan = Scan {
        id: "sv1".into(),
        target: "t".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Running,
        mode: "auto".into(),
        created_at: now(),
        started_at: None,
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    let vuln = Vulnerability {
        id: "v-1".into(),
        scan_id: "sv1".into(),
        agent_id: "a1".into(),
        title: "SQL Injection".into(),
        severity: Severity::Critical,
        description: "Found SQL injection in login".into(),
        affected_url: Some("https://example.com/login".into()),
        proof_of_concept: Some("' OR 1=1 --".into()),
        impact: Some("Full database access".into()),
        remediation: Some("Use parameterized queries".into()),
        cvss: Some(9.8),
        references: Some(vec!["https://cwe.mitre.org/data/definitions/89.html".into()]),
        discovered_at: now(),
    };
    db.save_vulnerability(&vuln).unwrap();

    let vulns = db.get_vulns_by_scan("sv1").unwrap();
    assert_eq!(vulns.len(), 1);
    assert_eq!(vulns[0].title, "SQL Injection");
    assert_eq!(vulns[0].severity, Severity::Critical);
    assert_eq!(vulns[0].references.as_ref().unwrap().len(), 1);
}

// ==================== Log CRUD ====================

#[test]
fn test_save_and_get_logs() {
    let db = make_db();
    let scan = Scan {
        id: "sl1".into(),
        target: "t".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Running,
        mode: "auto".into(),
        created_at: now(),
        started_at: None,
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    for i in 0..5 {
        let log = LogEntry {
            id: format!("log-{}", i),
            scan_id: "sl1".into(),
            agent_id: Some("a1".into()),
            level: LogLevel::Info,
            message: format!("msg-{}", i),
            tool_name: Some("browser_action".into()),
            timestamp: format!("2025-01-01T00:0{}:00Z", i),
            details: None,
        };
        db.save_log(&log).unwrap();
    }

    let logs = db.get_logs_by_scan("sl1").unwrap();
    assert_eq!(logs.len(), 5);

    let recent = db.get_recent_logs("sl1", 3).unwrap();
    assert_eq!(recent.len(), 3);
    // Recent logs should be in chronological order (reversed from DESC)
    assert_eq!(recent[0].id, "log-2");
}

#[test]
fn test_log_insert_or_ignore() {
    let db = make_db();
    let scan = Scan {
        id: "sl2".into(),
        target: "t".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Running,
        mode: "auto".into(),
        created_at: now(),
        started_at: None,
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    let log = LogEntry {
        id: "dup-log".into(),
        scan_id: "sl2".into(),
        agent_id: None,
        level: LogLevel::Info,
        message: "msg".into(),
        tool_name: None,
        timestamp: now(),
        details: None,
    };
    db.save_log(&log).unwrap();
    db.save_log(&log).unwrap(); // duplicate — should be ignored

    let logs = db.get_logs_by_scan("sl2").unwrap();
    assert_eq!(logs.len(), 1);
}

// ==================== Clear All ====================

#[test]
fn test_clear_all() {
    let db = make_db();
    let scan = Scan {
        id: "sc".into(),
        target: "t".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Running,
        mode: "auto".into(),
        created_at: now(),
        started_at: None,
        completed_at: None,
        findings: 0,
        claude_session_id: None,
    };
    db.save_scan(&scan).unwrap();

    let agent = Agent {
        id: "ac".into(),
        scan_id: "sc".into(),
        name: "A".into(),
        parent_id: None,
        status: AgentStatus::Running,
        task: "t".into(),
        created_at: now(),
        finished_at: None,
    };
    db.save_agent(&agent).unwrap();

    db.clear_all().unwrap();
    assert!(db.get_all_scans().unwrap().is_empty());
    assert!(db.get_all_agents().unwrap().is_empty());
}

// ==================== Chat Session CRUD ====================

#[test]
fn test_chat_session_crud() {
    let db = make_db();
    let session = ChatSession {
        id: "cs-1".into(),
        user_id: "user-1".into(),
        scan_id: None,
        claude_session_id: None,
        claude_session_mode: None,
        cwd: None,
        title: "New Chat".into(),
        created_at: now(),
        updated_at: now(),
    };
    db.create_chat_session(&session).unwrap();

    let loaded = db.get_chat_session("cs-1", "user-1").unwrap().unwrap();
    assert_eq!(loaded.title, "New Chat");

    // Wrong user should return None
    let wrong = db.get_chat_session("cs-1", "user-2").unwrap();
    assert!(wrong.is_none());

    // List by user
    let sessions = db.get_chat_sessions_by_user("user-1").unwrap();
    assert_eq!(sessions.len(), 1);

    // Update title
    db.update_chat_session_title("cs-1", "user-1", "Renamed").unwrap();
    let loaded = db.get_chat_session("cs-1", "user-1").unwrap().unwrap();
    assert_eq!(loaded.title, "Renamed");

    // Update claude ID
    db.update_chat_session_claude_id("cs-1", "user-1", "claude-id-1", Some("ask")).unwrap();
    let loaded = db.get_chat_session("cs-1", "user-1").unwrap().unwrap();
    assert_eq!(loaded.claude_session_id, Some("claude-id-1".into()));
    assert_eq!(loaded.claude_session_mode, Some("ask".into()));

    // Get by ID (no user check)
    let by_id = db.get_chat_session_by_id("cs-1").unwrap().unwrap();
    assert_eq!(by_id.id, "cs-1");

    // Delete
    db.delete_chat_session("cs-1", "user-1").unwrap();
    let deleted = db.get_chat_session("cs-1", "user-1").unwrap();
    assert!(deleted.is_none());
}

#[test]
fn test_chat_message_crud() {
    let db = make_db();
    let session = ChatSession {
        id: "cs-msg".into(),
        user_id: "user-1".into(),
        scan_id: None,
        claude_session_id: None,
        claude_session_mode: None,
        cwd: None,
        title: "Chat".into(),
        created_at: "2025-01-01T00:00:00Z".into(),
        updated_at: "2025-01-01T00:00:00Z".into(),
    };
    db.create_chat_session(&session).unwrap();

    let msg1 = ChatMessageRecord {
        id: "m-1".into(),
        session_id: "cs-msg".into(),
        role: "user".into(),
        content: "Hello".into(),
        is_execute: None,
        blocks: None,
        created_at: "2025-01-01T00:01:00Z".into(),
    };
    db.add_chat_message(&msg1).unwrap();

    let msg2 = ChatMessageRecord {
        id: "m-2".into(),
        session_id: "cs-msg".into(),
        role: "assistant".into(),
        content: "Hi there".into(),
        is_execute: Some(true),
        blocks: Some(r#"[{"type":"text","text":"Hi"}]"#.into()),
        created_at: "2025-01-01T00:02:00Z".into(),
    };
    db.add_chat_message(&msg2).unwrap();

    let messages = db.get_chat_messages("cs-msg", "user-1").unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].role, "user");
    assert_eq!(messages[1].role, "assistant");
    assert_eq!(messages[1].is_execute, Some(true));
    assert!(messages[1].blocks.is_some());

    // Session timestamp should be updated
    let session = db.get_chat_session("cs-msg", "user-1").unwrap().unwrap();
    assert_eq!(session.updated_at, "2025-01-01T00:02:00Z");
}

// ==================== Serde Roundtrip Tests ====================

#[test]
fn test_scan_serde_roundtrip() {
    let scan = Scan {
        id: "s1".into(),
        target: "https://example.com".into(),
        target_type: TargetType::Url,
        status: ScanStatus::Running,
        mode: "deep".into(),
        created_at: "2025-01-01T00:00:00Z".into(),
        started_at: Some("2025-01-01T00:00:01Z".into()),
        completed_at: None,
        findings: 3,
        claude_session_id: Some("sess-1".into()),
    };

    let json = serde_json::to_string(&scan).unwrap();
    // Verify camelCase field names
    assert!(json.contains("\"targetType\":\"url\""));
    assert!(json.contains("\"createdAt\""));
    assert!(json.contains("\"claudeSessionId\""));

    let deserialized: Scan = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.id, scan.id);
    assert_eq!(deserialized.target_type, TargetType::Url);
}

#[test]
fn test_ws_message_serde() {
    let msg = WSMessage::Pong {
        payload: PongPayload {
            timestamp: "2025-01-01T00:00:00Z".into(),
        },
    };
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"type\":\"PONG\""));

    let msg = WSMessage::InitState {
        payload: InitStatePayload {
            scan: None,
            agents: vec![],
            tool_executions: vec![],
            vulnerabilities: vec![],
            logs: vec![],
        },
    };
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"type\":\"INIT_STATE\""));
    assert!(json.contains("\"toolExecutions\""));
}

#[test]
fn test_ws_client_message_serde() {
    let ping_json = r#"{"type":"PING"}"#;
    let msg: WSClientMessage = serde_json::from_str(ping_json).unwrap();
    assert!(matches!(msg, WSClientMessage::Ping));

    let clear_json = r#"{"type":"CLEAR_ALL"}"#;
    let msg: WSClientMessage = serde_json::from_str(clear_json).unwrap();
    assert!(matches!(msg, WSClientMessage::ClearAll));

    let sub_json = r#"{"type":"SUBSCRIBE_SCAN","payload":{"scanId":"s1"}}"#;
    let msg: WSClientMessage = serde_json::from_str(sub_json).unwrap();
    assert!(matches!(msg, WSClientMessage::SubscribeScan { .. }));
}

#[test]
fn test_internal_event_serde() {
    let event_json = r#"{"type":"TOOL_STARTED","timestamp":"2025-01-01T00:00:00Z","scanId":"s1","sessionId":"sess1","toolUseId":"tu1","toolName":"browser_action","toolInput":{"action":"goto"}}"#;
    let event: InternalEvent = serde_json::from_str(event_json).unwrap();
    match event {
        InternalEvent::ToolStarted { tool_name, .. } => assert_eq!(tool_name, "browser_action"),
        _ => panic!("Expected ToolStarted"),
    }

    let event_json = r#"{"type":"VULNERABILITY_FOUND","timestamp":"2025-01-01T00:00:00Z","scanId":"s1","agentId":"a1","vulnerability":{"title":"XSS","severity":"high","description":"Found XSS"}}"#;
    let event: InternalEvent = serde_json::from_str(event_json).unwrap();
    match event {
        InternalEvent::VulnerabilityFound { vulnerability, .. } => {
            assert_eq!(vulnerability.title, "XSS");
            assert_eq!(vulnerability.severity, "high");
        }
        _ => panic!("Expected VulnerabilityFound"),
    }
}

#[test]
fn test_severity_ordering() {
    assert!(Severity::Critical < Severity::High);
    assert!(Severity::High < Severity::Medium);
    assert!(Severity::Medium < Severity::Low);
    assert!(Severity::Low < Severity::Info);
    assert_eq!(Severity::Critical.score(), 5);
    assert_eq!(Severity::Info.score(), 1);
}
