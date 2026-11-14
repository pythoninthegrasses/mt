//! Tauri-independent music player logic.
//!
//! Desktop commands, event emission, and application state belong in `mt-tauri`.

pub mod cache;
pub mod db;
pub mod lastfm;
pub mod plex;
pub mod scanner;
