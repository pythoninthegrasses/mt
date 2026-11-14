//! Plex HTTP client, response types, and database library merging.
//!
//! Desktop settings, downloads, and event emission belong in `mt-tauri`.

pub mod client;
pub mod merge;
pub mod types;

pub use merge::PlexMergeStats;
pub use types::{DirectoryDto, IdentityRoot, PlexAlbum, PlexConfig, PlexTrack, SectionsRoot};
