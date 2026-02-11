use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};

const SANDBOX_IMAGE: &str = "strix/sandbox-mcp:latest";

/// Structured preflight step event, matching TypeScript `PreflightStep`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightStep {
    pub step: u32,
    pub total_steps: u32,
    pub id: String,
    pub label: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Check if Docker daemon is running (`docker info` with 5s timeout).
async fn is_docker_running() -> bool {
    match tokio::time::timeout(
        Duration::from_secs(5),
        tokio::process::Command::new("docker")
            .arg("info")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status(),
    )
    .await
    {
        Ok(Ok(status)) => status.success(),
        _ => false,
    }
}

/// Check if a Docker image exists locally.
async fn has_docker_image(image_name: &str) -> bool {
    match tokio::time::timeout(
        Duration::from_secs(10),
        tokio::process::Command::new("docker")
            .args(["images", "-q", image_name])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output(),
    )
    .await
    {
        Ok(Ok(output)) => output.status.success() && !output.stdout.is_empty(),
        _ => false,
    }
}

/// Search known locations for the sandbox Dockerfile.
fn find_docker_context() -> Option<PathBuf> {
    // Search relative to the current working directory
    let cwd = std::env::current_dir().unwrap_or_default();
    let candidates = [
        // From project root
        cwd.join("strix-sandbox-mcp/container"),
        cwd.join("mcp-server/container"),
        // From src-tauri directory
        cwd.join("../strix-sandbox-mcp/container"),
        cwd.join("../mcp-server/container"),
        // Absolute fallback via home directory
        dirs::home_dir()
            .unwrap_or_default()
            .join("strix/strix-sandbox-mcp/container"),
        dirs::home_dir()
            .unwrap_or_default()
            .join("strix/mcp-server/container"),
    ];

    for dir in &candidates {
        if dir.join("Dockerfile").exists() {
            return Some(dir.clone());
        }
    }
    None
}

/// Build the sandbox Docker image, emitting structured step detail updates.
async fn build_docker_image_with_steps<F>(context_dir: &PathBuf, on_detail: F) -> anyhow::Result<()>
where
    F: Fn(String) + Send,
{
    let dockerfile_path = context_dir.join("Dockerfile");
    on_detail("Starting build...".to_string());

    let mut child = tokio::process::Command::new("docker")
        .args([
            "build",
            "-t",
            SANDBOX_IMAGE,
            "-f",
            &dockerfile_path.to_string_lossy(),
            &context_dir.to_string_lossy(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // Read stdout for build progress
    if let Some(stdout) = child.stdout.take() {
        let on_detail_ref = &on_detail;
        let mut lines = BufReader::new(stdout).lines();
        // Spawn a task to consume stdout
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        tokio::spawn(async move {
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx.send(line);
            }
        });

        // Also consume stderr (BuildKit outputs progress there)
        if let Some(stderr) = child.stderr.take() {
            let tx2 = tokio::sync::mpsc::unbounded_channel::<String>();
            let tx_clone = tx2.0;
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx_clone.send(line);
                }
            });
            // Merge stderr into the same receiver
            let mut rx2 = tx2.1;
            tokio::spawn(async move {
                while let Some(line) = rx2.recv().await {
                    // Just log stderr lines
                    tracing::debug!("[Docker build stderr] {}", line);
                }
            });
        }

        let mut last_line = String::new();
        // Process lines from stdout
        while let Some(line) = rx.recv().await {
            if line == last_line {
                continue;
            }
            if line.starts_with("Step") || line.starts_with('#') || line.contains("DONE") || line.contains("CACHED") {
                last_line = line.clone();
                let detail = if line.len() > 80 {
                    line[..80].to_string()
                } else {
                    line.clone()
                };
                on_detail_ref(detail);
            }
        }
    }

    let status = child.wait().await?;
    if status.success() {
        Ok(())
    } else {
        anyhow::bail!(
            "Docker build failed with exit code {}. Check the Dockerfile at {:?}",
            status.code().unwrap_or(-1),
            context_dir.join("Dockerfile")
        );
    }
}

/// Ensure Docker is running and the sandbox image exists.
/// Auto-starts Docker if needed and builds the image if missing.
///
/// Matches TypeScript `ensureDockerReady()`.
pub async fn ensure_docker_ready(timeout_ms: u64) -> anyhow::Result<()> {
    // Step 1: Ensure Docker daemon is running
    if !is_docker_running().await {
        let os = std::env::consts::OS;
        if os == "macos" {
            tracing::info!("[Docker] Starting Docker Desktop...");
            tokio::process::Command::new("open")
                .args(["-a", "Docker"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .map_err(|_| anyhow::anyhow!("Failed to start Docker Desktop. Is it installed?"))?;
        } else if os == "linux" {
            tracing::info!("[Docker] Starting Docker service...");
            tokio::process::Command::new("systemctl")
                .args(["start", "docker"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .map_err(|_| anyhow::anyhow!("Failed to start Docker service. Try: sudo systemctl start docker"))?;
        } else {
            anyhow::bail!("Docker is not running. Please start Docker Desktop manually.");
        }

        // Poll until ready
        let start = std::time::Instant::now();
        let timeout = Duration::from_millis(timeout_ms);
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if is_docker_running().await {
                break;
            }
            if start.elapsed() > timeout {
                anyhow::bail!(
                    "Docker failed to start within {}s. Please start Docker Desktop manually.",
                    timeout_ms / 1000
                );
            }
        }
    }

    // Step 2: Check if sandbox image exists
    if has_docker_image(SANDBOX_IMAGE).await {
        return Ok(());
    }

    // Step 3: Build the image
    let context_dir = find_docker_context().ok_or_else(|| {
        anyhow::anyhow!(
            "Docker image {} not found and Dockerfile could not be located. \
             Please build it manually: cd strix-sandbox-mcp/container && docker build -t {} .",
            SANDBOX_IMAGE,
            SANDBOX_IMAGE
        )
    })?;

    build_docker_image_with_steps(&context_dir, |msg| {
        tracing::info!("[Docker] {}", msg);
    })
    .await?;

    if !has_docker_image(SANDBOX_IMAGE).await {
        anyhow::bail!(
            "Docker image {} was not found after build. Check build output for errors.",
            SANDBOX_IMAGE
        );
    }

    Ok(())
}

/// Ensure Docker is running and the sandbox image exists, emitting structured
/// PreflightStep events for each phase.
///
/// Matches TypeScript `ensureDockerReadyWithSteps()`.
pub async fn ensure_docker_ready_with_steps<F>(on_step: F, timeout_ms: u64) -> anyhow::Result<()>
where
    F: Fn(PreflightStep) + Send + Sync,
{
    const TOTAL: u32 = 3;

    let emit =
        |step: u32, id: &str, label: &str, status: &str, detail: Option<&str>| {
            on_step(PreflightStep {
                step,
                total_steps: TOTAL,
                id: id.to_string(),
                label: label.to_string(),
                status: status.to_string(),
                detail: detail.map(|s| s.to_string()),
            });
        };

    // --- Step 1: Docker Engine ---
    emit(1, "docker", "Docker Engine", "running", Some("Checking Docker..."));

    if is_docker_running().await {
        emit(1, "docker", "Docker Engine", "done", None);
    } else {
        let os = std::env::consts::OS;
        if os == "macos" {
            emit(
                1,
                "docker",
                "Docker Engine",
                "running",
                Some("Starting Docker Desktop..."),
            );
            tokio::process::Command::new("open")
                .args(["-a", "Docker"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .map_err(|_| {
                    anyhow::anyhow!("Failed to start Docker Desktop. Is it installed?")
                })?;
        } else if os == "linux" {
            emit(
                1,
                "docker",
                "Docker Engine",
                "running",
                Some("Starting Docker service..."),
            );
            tokio::process::Command::new("systemctl")
                .args(["start", "docker"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .map_err(|_| {
                    anyhow::anyhow!(
                        "Failed to start Docker service. Try: sudo systemctl start docker"
                    )
                })?;
        } else {
            anyhow::bail!("Docker is not running. Please start Docker Desktop manually.");
        }

        // Poll until Docker is ready
        let start = std::time::Instant::now();
        let timeout = Duration::from_millis(timeout_ms);
        let mut ready = false;
        while start.elapsed() < timeout {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if is_docker_running().await {
                ready = true;
                break;
            }
            let elapsed = start.elapsed().as_secs();
            emit(
                1,
                "docker",
                "Docker Engine",
                "running",
                Some(&format!("Waiting for Docker... ({}s)", elapsed)),
            );
        }
        if !ready {
            anyhow::bail!(
                "Docker failed to start within {}s. Please start Docker Desktop manually.",
                timeout_ms / 1000
            );
        }
        emit(1, "docker", "Docker Engine", "done", None);
    }

    // --- Step 2: Sandbox Image ---
    emit(2, "image", "Sandbox Image", "running", Some("Checking image..."));

    if has_docker_image(SANDBOX_IMAGE).await {
        emit(2, "image", "Sandbox Image", "done", None);
        return Ok(());
    }

    emit(
        2,
        "image",
        "Sandbox Image",
        "running",
        Some("Image not found, locating Dockerfile..."),
    );

    let context_dir = find_docker_context().ok_or_else(|| {
        anyhow::anyhow!(
            "Docker image {} not found and Dockerfile could not be located. \
             Please build it manually: cd strix-sandbox-mcp/container && docker build -t {} .",
            SANDBOX_IMAGE,
            SANDBOX_IMAGE
        )
    })?;

    build_docker_image_with_steps(&context_dir, |detail| {
        emit(2, "image", "Sandbox Image", "running", Some(&detail));
    })
    .await?;

    if !has_docker_image(SANDBOX_IMAGE).await {
        anyhow::bail!(
            "Docker image {} was not found after build. Check build output for errors.",
            SANDBOX_IMAGE
        );
    }

    emit(2, "image", "Sandbox Image", "done", None);

    Ok(())
}
