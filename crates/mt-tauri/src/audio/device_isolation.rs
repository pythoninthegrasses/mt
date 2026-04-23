use crate::audio::audio_error::AudioError;
use crate::audio::list_output_devices;
use rodio::cpal::traits::{DeviceTrait, HostTrait};
use std::panic::AssertUnwindSafe;
use std::sync::mpsc;
use std::time::Duration;
#[cfg(not(test))]
use tracing::{debug, warn};

/// Print device names as JSON to stdout and exit.
/// Called when the process is spawned in enumeration mode (`MT_ENUMERATE_DEVICES=1`).
pub fn enumerate_devices_to_stdout() {
    match list_output_devices() {
        Ok(devices) => {
            let json = serde_json::to_string(&devices).unwrap_or_else(|_| "[]".to_string());
            println!("{json}");
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("Device enumeration failed: {e}");
            std::process::exit(1);
        }
    }
}

/// List output devices via a subprocess for crash isolation.
///
/// Spawns the current executable with `MT_ENUMERATE_DEVICES=1`. The subprocess
/// enumerates CoreAudio devices, prints JSON to stdout, and exits. If CoreAudio
/// crashes (SIGSEGV) during enumeration, only the subprocess dies — the parent
/// process receives an error rather than crashing.
///
/// In test builds, calls `list_output_devices()` directly because the test
/// binary's harness does not handle `MT_ENUMERATE_DEVICES`, and spawning it
/// would fork-bomb the test runner.
pub fn safe_list_output_devices(timeout: Duration) -> Result<Vec<String>, AudioError> {
    #[cfg(test)]
    {
        let _ = timeout;
        return list_output_devices();
    }

    #[cfg(not(test))]
    safe_list_output_devices_subprocess(timeout)
}

#[cfg(not(test))]
fn safe_list_output_devices_subprocess(timeout: Duration) -> Result<Vec<String>, AudioError> {
    let exe = std::env::current_exe()
        .map_err(|e| AudioError::Device(format!("Failed to get executable path: {e}")))?;

    let mut child = std::process::Command::new(exe)
        .env("MT_ENUMERATE_DEVICES", "1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AudioError::Device(format!("Failed to spawn device enumerator: {e}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AudioError::Device("Failed to capture subprocess stdout".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AudioError::Device("Failed to capture subprocess stderr".into()))?;

    let stdout_thread = std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = String::new();
        std::io::BufReader::new(stdout)
            .read_to_string(&mut buf)
            .ok();
        buf
    });
    let stderr_thread = std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = String::new();
        std::io::BufReader::new(stderr)
            .read_to_string(&mut buf)
            .ok();
        buf
    });

    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout_text = stdout_thread.join().unwrap_or_default();
                let stderr_text = stderr_thread.join().unwrap_or_default();

                if status.success() {
                    let devices: Vec<String> = serde_json::from_str(&stdout_text).map_err(|e| {
                        AudioError::Device(format!("Failed to parse device list: {e}"))
                    })?;
                    debug!(count = devices.len(), "Enumerated devices via subprocess");
                    return Ok(devices);
                } else {
                    warn!(
                        exit_code = ?status.code(),
                        stderr = %stderr_text.trim(),
                        "Device enumerator subprocess failed"
                    );
                    return Err(AudioError::Device(format!(
                        "Device enumeration subprocess failed: {}",
                        stderr_text.trim()
                    )));
                }
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(AudioError::Device("Device enumeration timed out".into()));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                return Err(AudioError::Device(format!(
                    "Failed to wait for enumerator: {e}"
                )));
            }
        }
    }
}

/// Resolve a named or default output device on a disposable thread.
///
/// CoreAudio device enumeration (`output_devices()`, `default_output_device()`)
/// runs on a short-lived thread, not the caller's thread. The resolved
/// `cpal::Device` (which is `Send`) is returned to the caller.
///
/// Panics on the disposable thread are caught; SIGSEGV still kills the process
/// (use `safe_list_output_devices` for full crash isolation when only names are
/// needed).
pub fn resolve_device(
    name: Option<&str>,
    timeout: Duration,
) -> Result<rodio::cpal::Device, AudioError> {
    let name_owned = name.map(|s| s.to_string());
    let (tx, rx) = mpsc::channel();

    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
            let host = rodio::cpal::default_host();
            match name_owned {
                Some(device_name) => {
                    let devices = host.output_devices().map_err(|e| {
                        AudioError::Device(format!("Failed to enumerate devices: {e}"))
                    })?;
                    devices
                        .into_iter()
                        .find(|d| d.name().ok().as_deref() == Some(device_name.as_str()))
                        .ok_or_else(|| {
                            AudioError::Device(format!("Device not found: {device_name}"))
                        })
                }
                None => host
                    .default_output_device()
                    .ok_or_else(|| AudioError::Device("No default output device found".into())),
            }
        }));

        let result = match result {
            Ok(inner) => inner,
            Err(_) => Err(AudioError::Device("Device resolution panicked".into())),
        };
        let _ = tx.send(result);
    });

    rx.recv_timeout(timeout).map_err(|e| match e {
        mpsc::RecvTimeoutError::Timeout => AudioError::Device("Device resolution timed out".into()),
        mpsc::RecvTimeoutError::Disconnected => {
            AudioError::Device("Device resolution thread terminated unexpectedly".into())
        }
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_device_default() {
        let result = resolve_device(None, Duration::from_secs(5));
        match result {
            Ok(device) => {
                assert!(device.name().is_ok(), "Resolved device should have a name");
            }
            Err(_) => {
                // Acceptable on headless CI without audio hardware
            }
        }
    }

    #[test]
    fn test_resolve_device_nonexistent_returns_error() {
        let result = resolve_device(Some("__nonexistent_device_12345__"), Duration::from_secs(5));
        // Should be Err(Device not found) or Err(enumerate failed) on headless CI
        match result {
            Ok(_) => panic!("Should not find a nonexistent device"),
            Err(e) => {
                let msg = e.to_string();
                assert!(
                    msg.contains("not found")
                        || msg.contains("enumerate")
                        || msg.contains("Device"),
                    "Unexpected error: {msg}"
                );
            }
        }
    }

    #[test]
    fn test_resolve_device_timeout() {
        // A very short timeout should still work for a real device resolution
        // (or fail gracefully)
        let result = resolve_device(None, Duration::from_millis(1));
        // Either succeeds quickly or times out — both are acceptable
        match result {
            Ok(device) => assert!(device.name().is_ok()),
            Err(e) => {
                let msg = e.to_string();
                assert!(
                    msg.contains("timed out")
                        || msg.contains("Device")
                        || msg.contains("terminated"),
                    "Unexpected error: {msg}"
                );
            }
        }
    }

    #[test]
    fn test_safe_list_output_devices_roundtrip() {
        let result = safe_list_output_devices(Duration::from_secs(15));
        match result {
            Ok(devices) => {
                for name in &devices {
                    assert!(!name.is_empty(), "Device name should not be empty");
                }
            }
            Err(e) => {
                // May fail on CI without audio or if subprocess launch fails
                let msg = e.to_string();
                assert!(
                    msg.contains("Device")
                        || msg.contains("failed")
                        || msg.contains("timed out")
                        || msg.contains("subprocess"),
                    "Unexpected error: {msg}"
                );
            }
        }
    }
}
