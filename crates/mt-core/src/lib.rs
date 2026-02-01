//! mt-core: Core library for mt music player
//!
//! This crate contains the Zig FFI bindings and types that are shared
//! between the core library and Tauri application.
//!
//! # Architecture
//!
//! The crate is organized as follows:
//! - `ffi`: FFI bindings to the Zig mtcore library
//!
//! # Usage
//!
//! ```ignore
//! use mt_core::ffi;
//!
//! // Use FFI types
//! let fp = ffi::FileFingerprint { ... };
//!
//! // Call FFI functions (unsafe)
//! unsafe {
//!     let version = ffi::mt_version();
//! }
//! ```

pub mod ffi;

// Re-export commonly used types at crate root for convenience
pub use ffi::{
    // Core types
    FileFingerprint,
    ExtractedMetadata,
    ScanStats,

    // Artwork cache
    FfiArtwork,
    ArtworkCacheHandle,

    // Inventory scanner
    InventoryScannerHandle,
    InventoryProgressCallback,

    // Database models
    Track,
    Playlist,
    QueueItem,
    SearchParams,
    QueueSnapshot,
    PlaylistInfo,
    SettingEntry,
    ScrobbleRecord,
    WatchedFolderFFI,

    // Last.fm types
    LastfmScrobbleRequest,
    LastfmNowPlayingRequest,
    LastfmBuiltRequest,
    LastfmApiResponse,
    LastfmClient,
};
