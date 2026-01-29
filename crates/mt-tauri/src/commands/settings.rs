//! Settings commands using Tauri Store API.
//!
//! Provides persistent key-value storage for user preferences.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;

/// Settings store filename
const STORE_NAME: &str = "settings.json";

/// Default settings values
fn get_defaults() -> HashMap<&'static str, JsonValue> {
    let mut defaults = HashMap::new();
    defaults.insert("volume", json!(75));
    defaults.insert("shuffle", json!(false));
    defaults.insert("loop_mode", json!("none"));
    defaults.insert("theme", json!("dark"));
    defaults.insert("sidebar_width", json!(250));
    defaults.insert("queue_panel_height", json!(300));
    defaults
}

/// All settings response
#[derive(Debug, Serialize, Deserialize)]
pub struct AllSettingsResponse {
    pub settings: HashMap<String, JsonValue>,
}

/// Single setting response
#[derive(Debug, Serialize, Deserialize)]
pub struct SettingResponse {
    pub key: String,
    pub value: JsonValue,
}

/// Settings update request
#[derive(Debug, Serialize, Deserialize)]
pub struct SettingsUpdateRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shuffle: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loop_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sidebar_width: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_panel_height: Option<i64>,
}

/// Settings update response
#[derive(Debug, Serialize, Deserialize)]
pub struct SettingsUpdateResponse {
    pub updated: Vec<String>,
}

/// Event payload for settings changes
#[derive(Debug, Clone, Serialize)]
pub struct SettingsChangedPayload {
    pub key: String,
    pub value: JsonValue,
}

/// Get all settings
#[tauri::command]
pub fn settings_get_all(app: AppHandle) -> Result<AllSettingsResponse, String> {
    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    let defaults = get_defaults();
    let mut settings: HashMap<String, JsonValue> = HashMap::new();

    // Load all settings with defaults
    for (key, default) in defaults {
        let value = store
            .get(key)
            .unwrap_or(default);
        settings.insert(key.to_string(), value);
    }

    // Also include any extra keys that might be in the store
    for key in store.keys() {
        if !settings.contains_key(&key)
            && let Some(value) = store.get(&key) {
                settings.insert(key, value.clone());
            }
    }

    Ok(AllSettingsResponse { settings })
}

/// Get a single setting
#[tauri::command]
pub fn settings_get(app: AppHandle, key: String) -> Result<SettingResponse, String> {
    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    let defaults = get_defaults();
    let value = store
        .get(&key)
        .or_else(|| defaults.get(key.as_str()).cloned())
        .unwrap_or(JsonValue::Null);

    Ok(SettingResponse { key, value })
}

/// Set a single setting
#[tauri::command]
pub fn settings_set(app: AppHandle, key: String, value: JsonValue) -> Result<SettingResponse, String> {
    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    store.set(key.clone(), value.clone());
    store.save().map_err(|e| format!("Failed to save settings: {}", e))?;

    // Emit settings changed event
    let _ = app.emit("settings://changed", SettingsChangedPayload {
        key: key.clone(),
        value: value.clone(),
    });

    Ok(SettingResponse { key, value })
}

/// Update multiple settings at once
#[tauri::command]
pub fn settings_update(app: AppHandle, settings: SettingsUpdateRequest) -> Result<SettingsUpdateResponse, String> {
    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    let mut updated = Vec::new();

    if let Some(volume) = settings.volume {
        // Validate volume range
        let vol = volume.clamp(0, 100);
        store.set("volume".to_string(), json!(vol));
        updated.push("volume".to_string());
        let _ = app.emit("settings://changed", SettingsChangedPayload {
            key: "volume".to_string(),
            value: json!(vol),
        });
    }

    if let Some(shuffle) = settings.shuffle {
        store.set("shuffle".to_string(), json!(shuffle));
        updated.push("shuffle".to_string());
        let _ = app.emit("settings://changed", SettingsChangedPayload {
            key: "shuffle".to_string(),
            value: json!(shuffle),
        });
    }

    if let Some(ref loop_mode) = settings.loop_mode {
        // Validate loop mode
        if ["none", "all", "one"].contains(&loop_mode.as_str()) {
            store.set("loop_mode".to_string(), json!(loop_mode));
            updated.push("loop_mode".to_string());
            let _ = app.emit("settings://changed", SettingsChangedPayload {
                key: "loop_mode".to_string(),
                value: json!(loop_mode),
            });
        }
    }

    if let Some(ref theme) = settings.theme {
        store.set("theme".to_string(), json!(theme));
        updated.push("theme".to_string());
        let _ = app.emit("settings://changed", SettingsChangedPayload {
            key: "theme".to_string(),
            value: json!(theme),
        });
    }

    if let Some(sidebar_width) = settings.sidebar_width {
        // Validate sidebar width range
        let width = sidebar_width.clamp(100, 500);
        store.set("sidebar_width".to_string(), json!(width));
        updated.push("sidebar_width".to_string());
        let _ = app.emit("settings://changed", SettingsChangedPayload {
            key: "sidebar_width".to_string(),
            value: json!(width),
        });
    }

    if let Some(queue_panel_height) = settings.queue_panel_height {
        // Validate queue panel height range
        let height = queue_panel_height.clamp(100, 800);
        store.set("queue_panel_height".to_string(), json!(height));
        updated.push("queue_panel_height".to_string());
        let _ = app.emit("settings://changed", SettingsChangedPayload {
            key: "queue_panel_height".to_string(),
            value: json!(height),
        });
    }

    if !updated.is_empty() {
        store.save().map_err(|e| format!("Failed to save settings: {}", e))?;
    }

    Ok(SettingsUpdateResponse { updated })
}

/// Reset settings to defaults
#[tauri::command]
pub fn settings_reset(app: AppHandle) -> Result<AllSettingsResponse, String> {
    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    let defaults = get_defaults();
    let mut settings: HashMap<String, JsonValue> = HashMap::new();

    // Clear existing and set defaults
    store.clear();

    for (key, value) in defaults {
        store.set(key.to_string(), value.clone());
        settings.insert(key.to_string(), value.clone());

        let _ = app.emit("settings://changed", SettingsChangedPayload {
            key: key.to_string(),
            value,
        });
    }

    store.save().map_err(|e| format!("Failed to save settings: {}", e))?;

    // Emit reset event
    let _ = app.emit("settings://reset", ());

    Ok(AllSettingsResponse { settings })
}

#[cfg(test)]
mod tests {
    use super::*;

    // =====================================================================
    // Default values tests
    // =====================================================================

    #[test]
    fn test_defaults() {
        let defaults = get_defaults();
        assert_eq!(defaults.get("volume"), Some(&json!(75)));
        assert_eq!(defaults.get("shuffle"), Some(&json!(false)));
        assert_eq!(defaults.get("loop_mode"), Some(&json!("none")));
        assert_eq!(defaults.get("theme"), Some(&json!("dark")));
        assert_eq!(defaults.get("sidebar_width"), Some(&json!(250)));
        assert_eq!(defaults.get("queue_panel_height"), Some(&json!(300)));
    }

    #[test]
    fn test_defaults_count() {
        let defaults = get_defaults();
        assert_eq!(defaults.len(), 6);
    }

    #[test]
    fn test_store_name_constant() {
        assert_eq!(STORE_NAME, "settings.json");
    }

    // =====================================================================
    // AllSettingsResponse tests
    // =====================================================================

    #[test]
    fn test_all_settings_response_serialization() {
        let mut settings = HashMap::new();
        settings.insert("volume".to_string(), json!(50));
        settings.insert("theme".to_string(), json!("light"));

        let response = AllSettingsResponse { settings };
        let json_str = serde_json::to_string(&response).unwrap();

        assert!(json_str.contains("\"volume\":50"));
        assert!(json_str.contains("\"theme\":\"light\""));
    }

    #[test]
    fn test_all_settings_response_deserialization() {
        let json_str = r#"{"settings":{"volume":80,"shuffle":true}}"#;
        let response: AllSettingsResponse = serde_json::from_str(json_str).unwrap();

        assert_eq!(response.settings.get("volume"), Some(&json!(80)));
        assert_eq!(response.settings.get("shuffle"), Some(&json!(true)));
    }

    #[test]
    fn test_all_settings_response_empty() {
        let response = AllSettingsResponse {
            settings: HashMap::new(),
        };
        let json_str = serde_json::to_string(&response).unwrap();
        assert_eq!(json_str, r#"{"settings":{}}"#);
    }

    // =====================================================================
    // SettingResponse tests
    // =====================================================================

    #[test]
    fn test_setting_response_string_value() {
        let response = SettingResponse {
            key: "theme".to_string(),
            value: json!("dark"),
        };

        let json_str = serde_json::to_string(&response).unwrap();
        assert!(json_str.contains("\"key\":\"theme\""));
        assert!(json_str.contains("\"value\":\"dark\""));
    }

    #[test]
    fn test_setting_response_number_value() {
        let response = SettingResponse {
            key: "volume".to_string(),
            value: json!(75),
        };

        let json_str = serde_json::to_string(&response).unwrap();
        assert!(json_str.contains("\"key\":\"volume\""));
        assert!(json_str.contains("\"value\":75"));
    }

    #[test]
    fn test_setting_response_bool_value() {
        let response = SettingResponse {
            key: "shuffle".to_string(),
            value: json!(true),
        };

        let json_str = serde_json::to_string(&response).unwrap();
        assert!(json_str.contains("\"key\":\"shuffle\""));
        assert!(json_str.contains("\"value\":true"));
    }

    #[test]
    fn test_setting_response_null_value() {
        let response = SettingResponse {
            key: "unknown".to_string(),
            value: JsonValue::Null,
        };

        let json_str = serde_json::to_string(&response).unwrap();
        assert!(json_str.contains("\"value\":null"));
    }

    #[test]
    fn test_setting_response_deserialization() {
        let json_str = r#"{"key":"volume","value":100}"#;
        let response: SettingResponse = serde_json::from_str(json_str).unwrap();

        assert_eq!(response.key, "volume");
        assert_eq!(response.value, json!(100));
    }

    // =====================================================================
    // SettingsUpdateRequest tests
    // =====================================================================

    #[test]
    fn test_settings_update_request_all_fields() {
        let request = SettingsUpdateRequest {
            volume: Some(50),
            shuffle: Some(true),
            loop_mode: Some("all".to_string()),
            theme: Some("light".to_string()),
            sidebar_width: Some(300),
            queue_panel_height: Some(400),
        };

        let json_str = serde_json::to_string(&request).unwrap();
        assert!(json_str.contains("\"volume\":50"));
        assert!(json_str.contains("\"shuffle\":true"));
        assert!(json_str.contains("\"loop_mode\":\"all\""));
        assert!(json_str.contains("\"theme\":\"light\""));
        assert!(json_str.contains("\"sidebar_width\":300"));
        assert!(json_str.contains("\"queue_panel_height\":400"));
    }

    #[test]
    fn test_settings_update_request_partial() {
        let request = SettingsUpdateRequest {
            volume: Some(80),
            shuffle: None,
            loop_mode: None,
            theme: None,
            sidebar_width: None,
            queue_panel_height: None,
        };

        let json_str = serde_json::to_string(&request).unwrap();
        assert!(json_str.contains("\"volume\":80"));
        // Optional fields with None should be skipped due to skip_serializing_if
        assert!(!json_str.contains("\"shuffle\""));
    }

    #[test]
    fn test_settings_update_request_deserialization() {
        let json_str = r#"{"volume":60,"shuffle":false}"#;
        let request: SettingsUpdateRequest = serde_json::from_str(json_str).unwrap();

        assert_eq!(request.volume, Some(60));
        assert_eq!(request.shuffle, Some(false));
        assert!(request.loop_mode.is_none());
        assert!(request.theme.is_none());
    }

    #[test]
    fn test_settings_update_request_empty() {
        let json_str = r#"{}"#;
        let request: SettingsUpdateRequest = serde_json::from_str(json_str).unwrap();

        assert!(request.volume.is_none());
        assert!(request.shuffle.is_none());
        assert!(request.loop_mode.is_none());
        assert!(request.theme.is_none());
        assert!(request.sidebar_width.is_none());
        assert!(request.queue_panel_height.is_none());
    }

    // =====================================================================
    // SettingsUpdateResponse tests
    // =====================================================================

    #[test]
    fn test_settings_update_response_serialization() {
        let response = SettingsUpdateResponse {
            updated: vec!["volume".to_string(), "theme".to_string()],
        };

        let json_str = serde_json::to_string(&response).unwrap();
        assert!(json_str.contains("\"updated\":[\"volume\",\"theme\"]"));
    }

    #[test]
    fn test_settings_update_response_empty() {
        let response = SettingsUpdateResponse { updated: vec![] };

        let json_str = serde_json::to_string(&response).unwrap();
        assert_eq!(json_str, r#"{"updated":[]}"#);
    }

    #[test]
    fn test_settings_update_response_deserialization() {
        let json_str = r#"{"updated":["shuffle","loop_mode"]}"#;
        let response: SettingsUpdateResponse = serde_json::from_str(json_str).unwrap();

        assert_eq!(response.updated.len(), 2);
        assert!(response.updated.contains(&"shuffle".to_string()));
        assert!(response.updated.contains(&"loop_mode".to_string()));
    }

    // =====================================================================
    // SettingsChangedPayload tests
    // =====================================================================

    #[test]
    fn test_settings_changed_payload_serialization() {
        let payload = SettingsChangedPayload {
            key: "volume".to_string(),
            value: json!(85),
        };

        let json_str = serde_json::to_string(&payload).unwrap();
        assert!(json_str.contains("\"key\":\"volume\""));
        assert!(json_str.contains("\"value\":85"));
    }

    #[test]
    fn test_settings_changed_payload_clone() {
        let payload = SettingsChangedPayload {
            key: "theme".to_string(),
            value: json!("dark"),
        };

        let cloned = payload.clone();
        assert_eq!(payload.key, cloned.key);
        assert_eq!(payload.value, cloned.value);
    }

    #[test]
    fn test_settings_changed_payload_debug() {
        let payload = SettingsChangedPayload {
            key: "shuffle".to_string(),
            value: json!(true),
        };

        let debug_str = format!("{:?}", payload);
        assert!(debug_str.contains("SettingsChangedPayload"));
        assert!(debug_str.contains("shuffle"));
    }

    // =====================================================================
    // Volume validation tests
    // =====================================================================

    #[test]
    fn test_volume_clamp_below_min() {
        let vol: i64 = -10;
        let clamped = vol.clamp(0, 100);
        assert_eq!(clamped, 0);
    }

    #[test]
    fn test_volume_clamp_above_max() {
        let vol: i64 = 150;
        let clamped = vol.clamp(0, 100);
        assert_eq!(clamped, 100);
    }

    #[test]
    fn test_volume_clamp_in_range() {
        let vol: i64 = 75;
        let clamped = vol.clamp(0, 100);
        assert_eq!(clamped, 75);
    }

    // =====================================================================
    // Loop mode validation tests
    // =====================================================================

    #[test]
    fn test_valid_loop_modes() {
        let valid_modes = ["none", "all", "one"];
        for mode in valid_modes {
            assert!(["none", "all", "one"].contains(&mode));
        }
    }

    #[test]
    fn test_invalid_loop_mode() {
        let mode = "invalid";
        assert!(!["none", "all", "one"].contains(&mode));
    }

    // =====================================================================
    // Sidebar width validation tests
    // =====================================================================

    #[test]
    fn test_sidebar_width_clamp_below_min() {
        let width: i64 = 50;
        let clamped = width.clamp(100, 500);
        assert_eq!(clamped, 100);
    }

    #[test]
    fn test_sidebar_width_clamp_above_max() {
        let width: i64 = 600;
        let clamped = width.clamp(100, 500);
        assert_eq!(clamped, 500);
    }

    // =====================================================================
    // Queue panel height validation tests
    // =====================================================================

    #[test]
    fn test_queue_panel_height_clamp_below_min() {
        let height: i64 = 50;
        let clamped = height.clamp(100, 800);
        assert_eq!(clamped, 100);
    }

    #[test]
    fn test_queue_panel_height_clamp_above_max() {
        let height: i64 = 1000;
        let clamped = height.clamp(100, 800);
        assert_eq!(clamped, 800);
    }
}
