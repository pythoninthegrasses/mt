//! Shell lifetime ownership of the app-data location (TASK-393.2).
//!
//! Acquire before database migration or runtime-file cleanup. The file is a
//! persistent lock anchor, not a PID file: never unlink it, including on exit.
//! Closing the last handle (also on process death) releases the OS lock.

use std::fs::{File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};

const LOCK_FILE_NAME: &str = "engine.lock";

#[derive(Debug, thiserror::Error)]
pub(crate) enum InstanceError {
    #[error("another mt instance owns this app-data location; close it before relaunching")]
    AlreadyRunning,
    #[error("could not acquire mt application-instance lock: {0}")]
    Io(#[from] std::io::Error),
}

/// Keep in Tauri managed state until shutdown has finished. Do not clone or
/// explicitly unlock the handle while an engine or migrator can still run.
#[derive(Debug)]
pub(crate) struct InstanceGuard {
    _lock: File,
    runtime_dir: PathBuf,
}

impl InstanceGuard {
    /// Create/resolve the app-data directory and immediately try its OS lock.
    /// Contention fails without waiting or touching the database/runtime file.
    pub(crate) fn acquire(runtime_dir: &Path) -> Result<Self, InstanceError> {
        std::fs::create_dir_all(runtime_dir)?;
        let runtime_dir = runtime_dir.canonicalize()?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options.open(runtime_dir.join(LOCK_FILE_NAME))?;
        match lock.try_lock() {
            Ok(()) => Ok(Self {
                _lock: lock,
                runtime_dir,
            }),
            Err(TryLockError::WouldBlock) => Err(InstanceError::AlreadyRunning),
            Err(TryLockError::Error(error)) => Err(InstanceError::Io(error)),
        }
    }

    pub(crate) fn runtime_dir(&self) -> &Path {
        &self.runtime_dir
    }
}

#[cfg(test)]
#[path = "instance_tests.rs"]
mod tests;
