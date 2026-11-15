//! Protocol v1 structural codec, independent of Tauri and storage.
//! Dispatch must additionally validate operation payloads and authorization.

use serde_json::Value;

/// Maximum UTF-8 JSON bytes, excluding an NDJSON LF delimiter.
pub const MAX_MESSAGE_BYTES: usize = 1024 * 1024;

/// Safe diagnostics deliberately never contain input or credentials.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ProtocolError {
    #[error("invalid engine protocol message")]
    Invalid,
    #[error("unsupported engine protocol version")]
    UnsupportedVersion,
    #[error("unknown engine protocol operation")]
    UnknownOperation,
    #[error("engine protocol message too large")]
    TooLarge,
    #[error("truncated engine protocol frame")]
    Truncated,
}

impl ProtocolError {
    /// Structured failure code for a safe, recoverably correlated response.
    pub fn code(self) -> &'static str {
        match self {
            Self::Invalid | Self::Truncated => "invalid_request",
            Self::UnsupportedVersion => "unsupported_version",
            Self::UnknownOperation => "unknown_operation",
            Self::TooLarge => "too_large",
        }
    }
}

type Result<T> = std::result::Result<T, ProtocolError>;

fn check(ok: bool) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(ProtocolError::Invalid)
    }
}

fn fields(value: &Value, required: &[&str], optional: &[&str]) -> Result<()> {
    let map = value.as_object().ok_or(ProtocolError::Invalid)?;
    check(required.iter().all(|key| map.contains_key(*key)))?;
    check(
        map.keys()
            .all(|key| required.contains(&key.as_str()) || optional.contains(&key.as_str())),
    )
}

fn identity(value: &Value) -> Result<()> {
    let text = value.as_str().ok_or(ProtocolError::Invalid)?;
    check(
        !text.is_empty()
            && text.len() <= 64
            && text
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c)),
    )
}

fn decimal(value: &Value, max: &str) -> Result<()> {
    let text = value.as_str().ok_or(ProtocolError::Invalid)?;
    check(
        !text.is_empty()
            && text.bytes().all(|c| c.is_ascii_digit())
            && (text == "0" || !text.starts_with('0'))
            && (text.len() < max.len() || (text.len() == max.len() && text <= max)),
    )
}

fn data(value: &Value, depth: usize, key: &str) -> Result<()> {
    check(depth <= 32)?;
    if [
        "revision",
        "sequence",
        "count",
        "timestamp_ms",
        "position_ms",
        "size_bytes",
    ]
    .contains(&key)
    {
        decimal(value, "18446744073709551615")?;
    }
    if key == "track_id" {
        decimal(value, "9223372036854775807")?;
        check(value.as_str() != Some("0"))?;
    }
    if key == "path" {
        check(value.as_str().is_some_and(|text| !text.contains('\0')))?;
    }
    match value {
        Value::Number(n) => check(
            n.as_f64()
                .is_some_and(|n| n.is_finite() && n.abs() <= 9_007_199_254_740_991.0),
        )?,
        Value::Array(items) => {
            for child in items {
                data(child, depth + 1, "")?;
            }
        }
        Value::Object(map) => {
            for (key, child) in map {
                data(child, depth + 1, key)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// HTTP error status mapping, also used to verify response status/envelope agreement.
pub fn error_status(code: &str) -> Option<u16> {
    Some(match code {
        "invalid_request" | "unsupported_version" => 400,
        "unauthenticated" => 401,
        "forbidden" => 403,
        "not_found" | "unknown_operation" => 404,
        "conflict" | "busy" | "cancelled" => 409,
        "too_large" => 413,
        "deadline_exceeded" | "outcome_uncertain" => 504,
        "unavailable" => 503,
        "internal" => 500,
        _ => return None,
    })
}

/// Decode one JSON body using a per-direction operation allowlist.
///
/// # Errors
/// Returns a redacted error on size, syntax, version, operation or structure failure.
pub fn decode(bytes: &[u8], operations: &[&str]) -> Result<Value> {
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err(ProtocolError::TooLarge);
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| ProtocolError::Invalid)?;
    validate(&value, operations)?;
    Ok(value)
}

fn validate(value: &Value, operations: &[&str]) -> Result<()> {
    let version = value["version"].as_f64().ok_or(ProtocolError::Invalid)?;
    check(version.is_finite() && version.fract() == 0.0)?;
    if version != 1.0 {
        return Err(ProtocolError::UnsupportedVersion);
    }
    identity(&value["generation"])?;
    identity(&value["operation"])?;
    if !value["operation"]
        .as_str()
        .is_some_and(|op| operations.contains(&op))
    {
        return Err(ProtocolError::UnknownOperation);
    }
    match value["kind"].as_str() {
        Some("request") => {
            fields(
                value,
                &[
                    "version",
                    "kind",
                    "generation",
                    "operation",
                    "id",
                    "payload",
                    "deadline_ms",
                ],
                &[],
            )?;
            identity(&value["id"])?;
            check(
                value["deadline_ms"]
                    .as_f64()
                    .is_some_and(|n| (1.0..=300_000.0).contains(&n) && n.fract() == 0.0),
            )?;
            check(value["payload"].is_object())?;
        }
        Some("response") => {
            fields(
                value,
                &["version", "kind", "generation", "operation", "id"],
                &["result", "error"],
            )?;
            identity(&value["id"])?;
            check(value.get("result").is_some() != value.get("error").is_some())?;
            if let Some(error) = value.get("error") {
                fields(error, &["code", "message", "retryable"], &["details"])?;
                check(error["code"].as_str().and_then(error_status).is_some())?;
                check(error["message"].as_str().is_some_and(|s| s.len() <= 1024))?;
                check(error["retryable"].is_boolean())?;
                if error["code"] == "outcome_uncertain" {
                    check(error["retryable"] == false)?;
                }
                if let Some(details) = error.get("details") {
                    check(details.is_object())?;
                }
            }
        }
        Some("event" | "observation") => {
            if value["kind"] == "event" {
                fields(
                    value,
                    &[
                        "version",
                        "kind",
                        "generation",
                        "operation",
                        "sequence",
                        "revision",
                        "payload",
                    ],
                    &[],
                )?;
                decimal(&value["revision"], "18446744073709551615")?;
            } else {
                fields(
                    value,
                    &[
                        "version",
                        "kind",
                        "generation",
                        "operation",
                        "sequence",
                        "payload",
                    ],
                    &[],
                )?;
            }
            decimal(&value["sequence"], "18446744073709551615")?;
            check(value["sequence"] != "0")?;
            check(value["payload"].is_object())?;
        }
        _ => return Err(ProtocolError::Invalid),
    }
    if value["operation"] == "control.cancel" {
        if value["kind"] == "request" {
            fields(&value["payload"], &["target_id"], &[])?;
            identity(&value["payload"]["target_id"])?;
        } else {
            check(value["kind"] == "response")?;
            if let Some(result) = value.get("result") {
                fields(result, &["state"], &[])?;
                check(
                    result["state"].as_str().is_some_and(|s| {
                        ["accepted", "already_finished", "not_found"].contains(&s)
                    }),
                )?;
            }
        }
    }
    data(value, 0, "")
}

/// Validate and serialize one message (without LF).
///
/// # Errors
/// Returns a redacted validation/size error.
pub fn encode(value: &Value, operations: &[&str]) -> Result<Vec<u8>> {
    validate(value, operations)?;
    let bytes = serde_json::to_vec(value).map_err(|_| ProtocolError::Invalid)?;
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err(ProtocolError::TooLarge);
    }
    Ok(bytes)
}

/// Verify generation, operation, correlation and HTTP status before consuming a response.
///
/// # Errors
/// Returns Invalid for stale, miscorrelated or status-inconsistent responses.
pub fn response(bytes: &[u8], request: &Value, status: u16, operations: &[&str]) -> Result<Value> {
    let message = decode(bytes, operations)?;
    check(
        message["kind"] == "response"
            && ["generation", "operation", "id"]
                .iter()
                .all(|key| message[*key] == request[*key]),
    )?;
    let expected = if let Some(error) = message.get("error") {
        error["code"]
            .as_str()
            .and_then(error_status)
            .ok_or(ProtocolError::Invalid)?
    } else {
        200
    };
    check(status == expected)?;
    Ok(message)
}

/// Incremental bounded framing; consume each returned slice before pushing again.
/// A framing error poisons this decoder. The caller must close the private channel.
#[derive(Default)]
pub struct Frames {
    buffer: Vec<u8>,
    complete: bool,
    failed: bool,
}

impl Frames {
    /// Push one byte, returning a complete LF-delimited body without copying it.
    ///
    /// # Errors
    /// Rejects empty/CRLF/oversized frames and any input after failure.
    pub fn push(&mut self, byte: u8) -> Result<Option<&[u8]>> {
        check(!self.failed)?;
        if self.complete {
            self.buffer.clear();
            self.complete = false;
        }
        if byte == b'\n' {
            if self.buffer.is_empty() || self.buffer.last() == Some(&b'\r') {
                self.failed = true;
                return Err(ProtocolError::Invalid);
            }
            self.complete = true;
            return Ok(Some(&self.buffer));
        }
        if self.buffer.len() == MAX_MESSAGE_BYTES {
            self.failed = true;
            return Err(ProtocolError::TooLarge);
        }
        self.buffer.push(byte);
        Ok(None)
    }

    /// Signal EOF; a final JSON body without LF is a truncated frame.
    ///
    /// # Errors
    /// Returns Truncated for a partial frame, Invalid after a framing failure.
    pub fn finish(&self) -> Result<()> {
        check(!self.failed)?;
        if !self.complete && !self.buffer.is_empty() {
            return Err(ProtocolError::Truncated);
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;
