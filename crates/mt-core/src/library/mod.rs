//! Library request handling — the layer between the desktop commands and SQL.
//!
//! [`crate::db::library`] owns the `tracks` SQL. This module owns what the
//! desktop `library_*` commands used to do around it: turn a request into a
//! [`crate::db::library::LibraryQuery`], assemble one response shape per view
//! (a paginated page, a section view model, the missing list), pair every
//! mutation with the bookkeeping that must share its transaction (removal
//! records, reconcile totals), and run the fingerprint/dedup pipeline.
//!
//! Nothing here knows about IPC. Functions take a [`crate::db::Database`] — or
//! a borrowed [`rusqlite::Connection`] where the caller owns the transaction —
//! and return the same `Result<_, String>` the commands returned, so the
//! frontend-facing error strings are unchanged by the move. Mutations report
//! what they changed instead of announcing it: event emission belongs to the
//! command adapters in `mt-tauri`.

pub mod mutations;
pub mod queries;
pub mod reconcile;
pub mod section;

pub use mutations::{LocateTrackOutcome, ReconcileStats};
pub use queries::{LibraryResponse, MissingTracksResponse};
pub use reconcile::{BackfillOutcome, ReconcileProgress, ReconcileScanResult};
pub use section::LibrarySectionResponse;

#[cfg(test)]
#[path = "test_util.rs"]
mod test_util;
