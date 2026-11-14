//! Desktop half of the reconcile pipeline: settings, progress events, emission.
//!
//! The pipeline itself — fingerprint backfill, within-directory dedup, and
//! cross-directory suppression — is `mt_core::library::reconcile`. This module
//! supplies the three things the core deliberately stays out of: reading
//! `settings.json`, turning the core's phase callbacks into `reconcile-progress`
//! events, and emitting the reconcile event for whatever dedup deleted.

use tauri::AppHandle;

use crate::events::{EventEmitter, LibraryReconcileEvent, ReconcileProgressEvent};
use mt_core::library as core_library;

pub use mt_core::library::ReconcileScanResult;

/// Bridges the core pipeline's phase callbacks onto `reconcile-progress` events.
struct ProgressEmitter<'a>(&'a AppHandle);

impl core_library::reconcile::ReconcileProgress for ProgressEmitter<'_> {
    fn fingerprinting(&self, done: u32, total: u32) {
        let _ = self
            .0
            .emit_reconcile_progress(ReconcileProgressEvent::fingerprinting(done, total));
    }

    fn deduplicating(&self, done: u32, total: u32) {
        let _ = self
            .0
            .emit_reconcile_progress(ReconcileProgressEvent::deduplicating(done, total));
    }

    fn cross_directory_dedup(&self, done: u32, total: u32) {
        let _ = self
            .0
            .emit_reconcile_progress(ReconcileProgressEvent::cross_directory_dedup(done, total));
    }

    fn complete(&self, total: u32) {
        let _ = self
            .0
            .emit_reconcile_progress(ReconcileProgressEvent::complete(total));
    }
}

/// `library.deduplicateAcrossDirectories`, defaulting to on.
fn cross_directory_dedup_enabled(app_handle: &AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;

    app_handle
        .store("settings.json")
        .ok()
        .and_then(|store| {
            store
                .get("library.deduplicateAcrossDirectories")
                .and_then(|v| v.as_bool())
        })
        .unwrap_or(true)
}

/// Run fingerprint backfill, within-directory dedup, and cross-directory dedup.
///
/// Shared between the manual reconcile scan command and the automatic
/// post-scan backfill. Runs on the calling thread (expected to be called
/// from `spawn_blocking`).
pub(crate) fn run_backfill_and_dedup(
    conn: &rusqlite::Connection,
    app_handle: &AppHandle,
) -> Result<ReconcileScanResult, String> {
    let outcome = core_library::reconcile::run_backfill_and_dedup(
        conn,
        cross_directory_dedup_enabled(app_handle),
        &ProgressEmitter(app_handle),
    )?;

    // Emit a single reconcile event with all deleted IDs and authoritative stats
    if let Some(dedup) = outcome.dedup {
        let _ = app_handle.emit_library_reconcile(LibraryReconcileEvent::dedup(
            dedup.deleted_ids,
            dedup.total_tracks,
            dedup.local_file_count,
            dedup.total_duration,
            dedup.revision,
        ));
    }

    Ok(outcome.result)
}
