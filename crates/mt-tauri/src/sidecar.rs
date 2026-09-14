//! Spawns and supervises the Zig core sidecar (TASK-355.4).
//!
//! The sidecar has no signal handler, so `sidecar.json` (port + bearer
//! token, written by `zig-core/src/runtime_file.zig`) can survive a killed
//! previous run. `spawn` deletes it before starting a new process and only
//! trusts a file that reappears afterward, via the health probe below.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tracing::{error, info, warn};

const SIDECAR_NAME: &str = "mt-zig-core";
pub(crate) const RUNTIME_FILE_NAME: &str = "sidecar.json";
const HEALTH_PROBE_ATTEMPTS: u32 = 30;
const HEALTH_PROBE_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Endpoint {
    pub(crate) port: u16,
    pub(crate) token: String,
}

#[derive(Debug, thiserror::Error)]
enum ProbeError {
    #[error("sidecar runtime file did not appear within the probe window")]
    RuntimeFileNotFound,
    #[error("health probe request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("health probe got unexpected status {0}")]
    UnexpectedStatus(reqwest::StatusCode),
}

/// Holds the spawned child (for shutdown) and the endpoint the health probe
/// resolved (for TASK-355.6 to read from later). Cleared, never dropped
/// implicitly — this crate has no `Drop` impls; cleanup is explicit via
/// `RunEvent::Exit`, matching `NetworkFileCache`.
///
/// `Arc`d so a command can hand the same state to a detached task (the
/// shadow-diff harness) without borrowing `tauri::State<'_, _>` past its own
/// invocation.
#[derive(Clone, Default)]
pub struct SidecarState {
    child: Arc<Mutex<Option<CommandChild>>>,
    endpoint: Arc<Mutex<Option<Endpoint>>>,
}

impl SidecarState {
    fn take_child(&self) -> Option<CommandChild> {
        self.child.lock().take()
    }

    fn clear_child(&self) {
        self.child.lock().take();
    }

    fn set_endpoint(&self, endpoint: Endpoint) {
        *self.endpoint.lock() = Some(endpoint);
    }

    /// The endpoint the startup health probe resolved, or `None` until it has
    /// succeeded. The shadow-diff harness (TASK-355.5) short-circuits on `None`
    /// rather than re-reading the runtime file itself.
    pub(crate) fn endpoint(&self) -> Option<Endpoint> {
        self.endpoint.lock().clone()
    }

    /// Build a `SidecarState` for an already-running sidecar, for tests that
    /// spawn it themselves instead of going through the Tauri shell plugin.
    #[cfg(test)]
    pub(crate) fn for_test(endpoint: Endpoint) -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            endpoint: Arc::new(Mutex::new(Some(endpoint))),
        }
    }
}

/// Spawns the sidecar and manages `SidecarState` on `app`. Every failure
/// path is logged and returns without panicking (AC#3) — a missing or
/// unspawnable sidecar must not prevent the rest of the app from starting.
pub fn spawn<R: Runtime>(app: &tauri::App<R>, db_path: &Path, runtime_dir: &Path) {
    let runtime_file = runtime_dir.join(RUNTIME_FILE_NAME);
    if let Err(e) = std::fs::remove_file(&runtime_file)
        && e.kind() != std::io::ErrorKind::NotFound
    {
        warn!(error = %e, path = %runtime_file.display(), "failed to remove stale sidecar runtime file");
    }

    let Some(db_path_str) = db_path.to_str() else {
        error!(path = ?db_path, "sidecar not started: db path is not valid UTF-8");
        return;
    };
    let Some(runtime_dir_str) = runtime_dir.to_str() else {
        error!(path = ?runtime_dir, "sidecar not started: runtime dir is not valid UTF-8");
        return;
    };

    let command = match app.shell().sidecar(SIDECAR_NAME) {
        Ok(command) => command,
        Err(e) => {
            error!(error = %e, "sidecar not started: {SIDECAR_NAME} is not configured under tauri.conf.json > bundle > externalBin, or the binary is missing for this platform");
            return;
        }
    };

    let (mut rx, child) = match command
        .args(["--db", db_path_str, "--runtime-dir", runtime_dir_str])
        .spawn()
    {
        Ok(pair) => pair,
        Err(e) => {
            error!(error = %e, "sidecar not started: failed to spawn {SIDECAR_NAME}");
            return;
        }
    };

    app.manage(SidecarState {
        child: Arc::new(Mutex::new(Some(child))),
        endpoint: Arc::new(Mutex::new(None)),
    });

    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    info!(target: "sidecar", "{}", String::from_utf8_lossy(&bytes).trim_end());
                }
                CommandEvent::Stderr(bytes) => {
                    info!(target: "sidecar", "{}", String::from_utf8_lossy(&bytes).trim_end());
                }
                CommandEvent::Error(err) => {
                    error!(target: "sidecar", error = %err, "sidecar command error");
                }
                CommandEvent::Terminated(payload) => {
                    error!(target: "sidecar", code = ?payload.code, signal = ?payload.signal, "sidecar process terminated");
                    if let Some(state) = app_handle.try_state::<SidecarState>() {
                        state.clear_child();
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    let app_handle = app.handle().clone();
    let runtime_dir = runtime_dir.to_path_buf();
    tauri::async_runtime::spawn(async move {
        match probe_health(&runtime_dir).await {
            Ok(endpoint) => {
                info!(port = endpoint.port, "sidecar health probe succeeded");
                if let Some(state) = app_handle.try_state::<SidecarState>() {
                    state.set_endpoint(endpoint);
                }
            }
            Err(e) => {
                warn!(error = %e, "sidecar health probe failed");
            }
        }
    });
}

async fn probe_health(runtime_dir: &Path) -> Result<Endpoint, ProbeError> {
    let runtime_file = runtime_dir.join(RUNTIME_FILE_NAME);

    let mut endpoint = None;
    for _ in 0..HEALTH_PROBE_ATTEMPTS {
        if let Ok(contents) = tokio::fs::read(&runtime_file).await
            && let Ok(parsed) = serde_json::from_slice::<Endpoint>(&contents)
        {
            endpoint = Some(parsed);
            break;
        }
        tokio::time::sleep(HEALTH_PROBE_INTERVAL).await;
    }
    let endpoint = endpoint.ok_or(ProbeError::RuntimeFileNotFound)?;

    let url = format!("http://127.0.0.1:{}/api/library?limit=1", endpoint.port);
    let response = reqwest::Client::new()
        .get(&url)
        .bearer_auth(&endpoint.token)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(ProbeError::UnexpectedStatus(response.status()));
    }

    Ok(endpoint)
}

/// Kills the sidecar on app exit, called from `RunEvent::Exit`. Idempotent:
/// the child is `take()`n, so a second call (or a prior `Terminated` event)
/// is a no-op rather than a double-kill error.
pub fn shutdown<R: Runtime>(app_handle: &AppHandle<R>) {
    let Some(state) = app_handle.try_state::<SidecarState>() else {
        return;
    };
    let Some(child) = state.take_child() else {
        return;
    };
    if let Err(e) = child.kill() {
        error!(error = %e, "failed to kill sidecar on exit");
    } else {
        info!("sidecar terminated on exit");
    }
}
