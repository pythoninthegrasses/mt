use tracing::{debug, info, warn};

use super::prompt::{DEFAULT_MODEL, OLLAMA_BASE_URL};
use super::types::{OllamaStatus, OnboardingState, PullModelResult, PullProgress};

const AGENT_STORE_NAME: &str = "agent.json";
const ONBOARDING_KEY: &str = "agent_onboarding";

pub async fn check_ollama_status() -> OllamaStatus {
    match super::check_ollama().await {
        Ok(models) => OllamaStatus {
            connected: true,
            models,
        },
        Err(e) => {
            debug!(error = %e, "Ollama not reachable");
            OllamaStatus {
                connected: false,
                models: vec![],
            }
        }
    }
}

fn parse_pull_progress_line(line: &str) -> Option<PullProgress> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_str(trimmed).ok()
}

pub async fn pull_model(app: &tauri::AppHandle, model: String) -> Result<PullModelResult, String> {
    use tauri::Emitter;

    let url = format!("{OLLAMA_BASE_URL}/api/pull");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    info!(model = %model, "Starting model pull");

    let mut response = client
        .post(&url)
        .json(&serde_json::json!({ "name": model, "stream": true }))
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                "Ollama is not running. Install from https://ollama.com/download".into()
            } else {
                format!("Failed to connect to Ollama: {e}")
            }
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama returned {status}: {body}"));
    }

    let mut last_status = String::new();
    let mut buffer = String::new();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Stream error: {e}"))?
    {
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            if let Some(progress) = parse_pull_progress_line(&line) {
                last_status.clone_from(&progress.status);
                debug!(
                    status = %progress.status,
                    completed = ?progress.completed,
                    total = ?progress.total,
                    "Pull progress"
                );
                let _ = app.emit("agent://pull-progress", &progress);
            }
        }
    }

    if !buffer.trim().is_empty() {
        if let Some(progress) = parse_pull_progress_line(&buffer) {
            last_status.clone_from(&progress.status);
            let _ = app.emit("agent://pull-progress", &progress);
        }
    }

    let success = last_status == "success";
    if success {
        info!(model = %model, "Model pull completed");
    } else {
        warn!(model = %model, last_status = %last_status, "Model pull finished with unexpected status");
    }

    Ok(PullModelResult {
        success,
        model: model.clone(),
        message: if success {
            format!("Model '{model}' downloaded successfully")
        } else {
            format!("Pull finished with status: {last_status}")
        },
    })
}

pub fn get_onboarding_state(app: &tauri::AppHandle) -> Result<OnboardingState, String> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store(AGENT_STORE_NAME)
        .map_err(|e| format!("Failed to open agent store: {e}"))?;

    let state = store
        .get(ONBOARDING_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    Ok(state)
}

pub fn set_onboarding_complete(
    app: &tauri::AppHandle,
    model: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store(AGENT_STORE_NAME)
        .map_err(|e| format!("Failed to open agent store: {e}"))?;

    let state = OnboardingState {
        completed: true,
        model: model.or_else(|| Some(DEFAULT_MODEL.into())),
    };

    store.set(
        ONBOARDING_KEY,
        serde_json::to_value(&state).map_err(|e| format!("Serialization error: {e}"))?,
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pull_progress_line_with_all_fields() {
        let line = r#"{"status":"pulling abc123","completed":500,"total":1000}"#;
        let progress = parse_pull_progress_line(line).unwrap();
        assert_eq!(progress.status, "pulling abc123");
        assert_eq!(progress.completed, Some(500));
        assert_eq!(progress.total, Some(1000));
    }

    #[test]
    fn parse_pull_progress_line_status_only() {
        let line = r#"{"status":"success"}"#;
        let progress = parse_pull_progress_line(line).unwrap();
        assert_eq!(progress.status, "success");
        assert_eq!(progress.completed, None);
        assert_eq!(progress.total, None);
    }

    #[test]
    fn parse_pull_progress_line_empty() {
        assert!(parse_pull_progress_line("").is_none());
        assert!(parse_pull_progress_line("  ").is_none());
    }

    #[test]
    fn parse_pull_progress_line_invalid_json() {
        assert!(parse_pull_progress_line("not json").is_none());
        assert!(parse_pull_progress_line("{broken").is_none());
    }

    #[test]
    fn parse_pull_progress_line_with_whitespace() {
        let line = r#"  {"status":"pulling","completed":100,"total":200}  "#;
        let progress = parse_pull_progress_line(line).unwrap();
        assert_eq!(progress.status, "pulling");
        assert_eq!(progress.completed, Some(100));
    }

    #[test]
    fn parse_pull_progress_line_verifying_status() {
        let line = r#"{"status":"verifying sha256 digest"}"#;
        let progress = parse_pull_progress_line(line).unwrap();
        assert_eq!(progress.status, "verifying sha256 digest");
    }

    #[tokio::test]
    async fn check_ollama_status_when_unavailable() {
        let status = check_ollama_status().await;
        if !status.connected {
            assert!(status.models.is_empty());
        }
    }
}
