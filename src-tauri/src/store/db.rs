use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

/// Shared database handle. All access goes through the Mutex.
/// For async contexts, wrap calls in `spawn_blocking`.
#[derive(Clone)]
pub struct AppDb {
    pub conn: Arc<Mutex<Connection>>,
}

impl AppDb {
    /// Open (or create) the database at the standard path `~/.strix-webui/strix.db`.
    pub fn open_default() -> anyhow::Result<Self> {
        let data_dir = Self::data_dir();
        std::fs::create_dir_all(&data_dir)?;
        let db_path = data_dir.join("strix.db");
        Self::open(&db_path)
    }

    /// Open (or create) an in-memory database for testing.
    pub fn open_memory() -> anyhow::Result<Self> {
        Self::open_connection(Connection::open_in_memory()?)
    }

    /// Open a database at a specific path.
    pub fn open(path: &std::path::Path) -> anyhow::Result<Self> {
        Self::open_connection(Connection::open(path)?)
    }

    fn open_connection(conn: Connection) -> anyhow::Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_tables()?;
        db.run_migrations()?;
        Ok(db)
    }

    /// Returns `~/.strix-webui`
    pub fn data_dir() -> PathBuf {
        dirs::home_dir()
            .expect("Could not determine home directory")
            .join(".strix-webui")
    }

    fn init_tables(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS scans (
                id TEXT PRIMARY KEY,
                target TEXT NOT NULL,
                target_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                mode TEXT NOT NULL DEFAULT 'auto',
                created_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                findings INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                scan_id TEXT NOT NULL,
                name TEXT NOT NULL,
                parent_id TEXT,
                status TEXT NOT NULL DEFAULT 'running',
                task TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                finished_at TEXT,
                FOREIGN KEY (scan_id) REFERENCES scans(id)
            );

            CREATE TABLE IF NOT EXISTS tool_executions (
                id TEXT PRIMARY KEY,
                scan_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                tool_input TEXT NOT NULL DEFAULT '{}',
                tool_output TEXT,
                status TEXT NOT NULL DEFAULT 'running',
                started_at TEXT NOT NULL,
                completed_at TEXT,
                duration REAL,
                FOREIGN KEY (scan_id) REFERENCES scans(id)
            );

            CREATE TABLE IF NOT EXISTS vulnerabilities (
                id TEXT PRIMARY KEY,
                scan_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                title TEXT NOT NULL,
                severity TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                affected_url TEXT,
                proof_of_concept TEXT,
                impact TEXT,
                remediation TEXT,
                cvss REAL,
                references_json TEXT,
                discovered_at TEXT NOT NULL,
                FOREIGN KEY (scan_id) REFERENCES scans(id)
            );

            CREATE TABLE IF NOT EXISTS logs (
                id TEXT PRIMARY KEY,
                scan_id TEXT NOT NULL,
                agent_id TEXT,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                tool_name TEXT,
                timestamp TEXT NOT NULL,
                details TEXT,
                FOREIGN KEY (scan_id) REFERENCES scans(id)
            );

            CREATE INDEX IF NOT EXISTS idx_agents_scan ON agents(scan_id);
            CREATE INDEX IF NOT EXISTS idx_tools_scan ON tool_executions(scan_id);
            CREATE INDEX IF NOT EXISTS idx_vulns_scan ON vulnerabilities(scan_id);
            CREATE INDEX IF NOT EXISTS idx_logs_scan ON logs(scan_id);

            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                scan_id TEXT,
                title TEXT NOT NULL DEFAULT 'New Chat',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                is_execute INTEGER NOT NULL DEFAULT 0,
                blocks TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
            ",
        )?;
        Ok(())
    }

    fn run_migrations(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        // Idempotent migrations — ignore errors if column already exists
        let _ = conn.execute_batch("ALTER TABLE scans ADD COLUMN claude_session_id TEXT");
        let _ = conn.execute_batch("ALTER TABLE chat_sessions ADD COLUMN claude_session_id TEXT");
        let _ = conn.execute_batch("ALTER TABLE chat_sessions ADD COLUMN cwd TEXT");
        let _ = conn.execute_batch("ALTER TABLE chat_sessions ADD COLUMN claude_session_mode TEXT");
        Ok(())
    }
}
