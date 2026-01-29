//! FFI bindings for Zig mtcore library
//!
//! This module provides Rust bindings to call Zig functions exported from libmtcore.a.
//! All types use #[repr(C)] to match Zig's extern struct layout.

use std::os::raw::c_char;

// ============================================================================
// Type Definitions (matching zig-core/src/types.zig)
// ============================================================================

/// File fingerprint for change detection
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct FileFingerprint {
    /// Modification time in nanoseconds since Unix epoch (0 if unavailable)
    pub mtime_ns: i64,
    /// File size in bytes
    pub size: i64,
    /// Inode number (0 if unavailable, Unix only)
    pub inode: u64,
    /// Whether mtime_ns is valid
    pub has_mtime: bool,
    /// Whether inode is valid
    pub has_inode: bool,
}

impl FileFingerprint {
    /// Check if two fingerprints match (ignores inode)
    pub fn matches(&self, other: &FileFingerprint) -> bool {
        if self.has_mtime != other.has_mtime {
            return false;
        }
        if self.has_mtime && self.mtime_ns != other.mtime_ns {
            return false;
        }
        self.size == other.size
    }
}

/// Extracted metadata from an audio file
/// Uses fixed-size buffers for FFI safety - no allocations cross the boundary
#[repr(C)]
#[derive(Debug, Clone)]
pub struct ExtractedMetadata {
    // File info
    pub filepath: [u8; 4096],
    pub filepath_len: u32,
    pub file_size: i64,
    pub file_mtime_ns: i64,
    pub file_inode: u64,
    pub has_mtime: bool,
    pub has_inode: bool,

    // Basic tags
    pub title: [u8; 512],
    pub title_len: u32,
    pub artist: [u8; 512],
    pub artist_len: u32,
    pub album: [u8; 512],
    pub album_len: u32,
    pub album_artist: [u8; 512],
    pub album_artist_len: u32,

    // Track info
    pub track_number: [u8; 32],
    pub track_number_len: u32,
    pub track_total: [u8; 32],
    pub track_total_len: u32,
    pub disc_number: u32,
    pub disc_total: u32,
    pub has_disc_number: bool,
    pub has_disc_total: bool,

    // Date/genre
    pub date: [u8; 64],
    pub date_len: u32,
    pub genre: [u8; 256],
    pub genre_len: u32,

    // Audio properties
    pub duration_secs: f64,
    pub bitrate: u32,
    pub sample_rate: u32,
    pub channels: u8,
    pub has_duration: bool,
    pub has_bitrate: bool,
    pub has_sample_rate: bool,
    pub has_channels: bool,

    // Status
    pub is_valid: bool,
    pub error_code: u32,
}

impl ExtractedMetadata {
    /// Get title as a string slice
    pub fn get_title(&self) -> &str {
        std::str::from_utf8(&self.title[..self.title_len as usize]).unwrap_or("")
    }

    /// Get artist as a string slice
    pub fn get_artist(&self) -> &str {
        std::str::from_utf8(&self.artist[..self.artist_len as usize]).unwrap_or("")
    }

    /// Get album as a string slice
    pub fn get_album(&self) -> &str {
        std::str::from_utf8(&self.album[..self.album_len as usize]).unwrap_or("")
    }

    /// Get filepath as a string slice
    pub fn get_filepath(&self) -> &str {
        std::str::from_utf8(&self.filepath[..self.filepath_len as usize]).unwrap_or("")
    }
}

/// Scan statistics
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct ScanStats {
    pub visited: u64,
    pub added: u64,
    pub modified: u64,
    pub unchanged: u64,
    pub deleted: u64,
    pub errors: u64,
}

// ============================================================================
// Artwork Cache Types (matching zig-core/src/scanner/artwork_cache.zig)
// ============================================================================

/// Artwork data from audio file or folder.
/// Uses fixed-size buffers for FFI safety - no allocations cross the boundary.
#[repr(C)]
#[derive(Debug, Clone)]
pub struct FfiArtwork {
    /// Base64-encoded image data (fixed-size buffer)
    pub data: [u8; 8192],
    pub data_len: u32,
    /// MIME type (e.g., "image/jpeg", "image/png")
    pub mime_type: [u8; 64],
    pub mime_type_len: u32,
    /// Source: "embedded" or "folder"
    pub source: [u8; 16],
    pub source_len: u32,
    /// Filename for folder-based artwork
    pub filename: [u8; 256],
    pub filename_len: u32,
    pub has_filename: bool,
}

impl FfiArtwork {
    /// Get the data as a byte slice
    pub fn get_data(&self) -> &[u8] {
        &self.data[..self.data_len as usize]
    }

    /// Get the MIME type as a string slice
    pub fn get_mime_type(&self) -> &str {
        std::str::from_utf8(&self.mime_type[..self.mime_type_len as usize]).unwrap_or("")
    }

    /// Get the source as a string slice
    pub fn get_source(&self) -> &str {
        std::str::from_utf8(&self.source[..self.source_len as usize]).unwrap_or("")
    }

    /// Get the filename if present
    pub fn get_filename(&self) -> Option<&str> {
        if self.has_filename {
            std::str::from_utf8(&self.filename[..self.filename_len as usize]).ok()
        } else {
            None
        }
    }
}

/// Opaque handle to Zig artwork cache
pub type ArtworkCacheHandle = *mut std::ffi::c_void;

// ============================================================================
// FFI Function Declarations (from zig-core/src/ffi.zig)
// ============================================================================

unsafe extern "C" {
    /// Extract metadata from a single file.
    /// Returns a pointer to ExtractedMetadata that must be freed with mt_free_metadata.
    pub fn mt_extract_metadata(path: *const c_char) -> *mut ExtractedMetadata;

    /// Free metadata returned by mt_extract_metadata
    pub fn mt_free_metadata(ptr: *mut ExtractedMetadata);

    /// Extract metadata into a caller-provided buffer (no allocation).
    /// Returns true on success.
    pub fn mt_extract_metadata_into(path: *const c_char, out: *mut ExtractedMetadata) -> bool;

    /// Batch extract metadata from multiple files.
    /// Caller provides arrays for paths and results.
    /// Returns number of successfully extracted files.
    pub fn mt_extract_metadata_batch(
        paths: *const *const c_char,
        count: usize,
        results: *mut ExtractedMetadata,
    ) -> usize;

    /// Check if a file has a supported audio extension
    pub fn mt_is_audio_file(path: *const c_char) -> bool;

    /// Get file fingerprint from path.
    /// Returns true on success, populates out_fp.
    pub fn mt_get_fingerprint(path: *const c_char, out_fp: *mut FileFingerprint) -> bool;

    /// Compare two fingerprints for equality (ignores inode)
    pub fn mt_fingerprint_matches(fp1: *const FileFingerprint, fp2: *const FileFingerprint)
        -> bool;

    /// Get library version string
    pub fn mt_version() -> *const c_char;

    // ========================================================================
    // Artwork Cache FFI
    // ========================================================================

    /// Create new artwork cache with default capacity (100 entries).
    /// Returns opaque handle or null on allocation failure.
    pub fn mt_artwork_cache_new() -> ArtworkCacheHandle;

    /// Create artwork cache with custom capacity.
    /// Returns opaque handle or null on allocation failure.
    pub fn mt_artwork_cache_new_with_capacity(capacity: usize) -> ArtworkCacheHandle;

    /// Get artwork for track, loading from file if not cached.
    /// Returns true if artwork was found, false otherwise.
    /// The out parameter is populated only when returning true.
    pub fn mt_artwork_cache_get_or_load(
        cache: ArtworkCacheHandle,
        track_id: i64,
        filepath: *const c_char,
        out: *mut FfiArtwork,
    ) -> bool;

    /// Invalidate cache entry for a specific track.
    /// Call this when track metadata is updated.
    pub fn mt_artwork_cache_invalidate(cache: ArtworkCacheHandle, track_id: i64);

    /// Clear all cache entries.
    pub fn mt_artwork_cache_clear(cache: ArtworkCacheHandle);

    /// Get current number of cached items.
    pub fn mt_artwork_cache_len(cache: ArtworkCacheHandle) -> usize;

    /// Free artwork cache and all associated resources.
    pub fn mt_artwork_cache_free(cache: ArtworkCacheHandle);
}

// ============================================================================
// Inventory Scanner FFI
// ============================================================================

/// Opaque handle to Zig inventory scanner
pub type InventoryScannerHandle = *mut std::ffi::c_void;

/// Progress callback type for inventory scanning
pub type InventoryProgressCallback = Option<extern "C" fn(visited: usize)>;

unsafe extern "C" {
    /// Create a new inventory scanner.
    /// Returns opaque handle or null on allocation failure.
    pub fn mt_inventory_scanner_new() -> InventoryScannerHandle;

    /// Set recursive mode for directory scanning.
    pub fn mt_inventory_scanner_set_recursive(handle: InventoryScannerHandle, recursive: bool);

    /// Add a path to scan.
    /// Returns true on success, false on allocation failure.
    pub fn mt_inventory_scanner_add_path(
        handle: InventoryScannerHandle,
        path: *const c_char,
    ) -> bool;

    /// Add a database fingerprint for comparison.
    /// Returns true on success, false on allocation failure.
    pub fn mt_inventory_scanner_add_db_fingerprint(
        handle: InventoryScannerHandle,
        path: *const c_char,
        fp: *const FileFingerprint,
    ) -> bool;

    /// Run the inventory scan.
    /// Returns true on success, false on error.
    pub fn mt_inventory_scanner_run(
        handle: InventoryScannerHandle,
        progress_callback: InventoryProgressCallback,
    ) -> bool;

    /// Get the count of added files.
    pub fn mt_inventory_scanner_get_added_count(handle: InventoryScannerHandle) -> usize;

    /// Get the count of modified files.
    pub fn mt_inventory_scanner_get_modified_count(handle: InventoryScannerHandle) -> usize;

    /// Get the count of unchanged files.
    pub fn mt_inventory_scanner_get_unchanged_count(handle: InventoryScannerHandle) -> usize;

    /// Get the count of deleted files.
    pub fn mt_inventory_scanner_get_deleted_count(handle: InventoryScannerHandle) -> usize;

    /// Get an added file entry by index.
    /// Returns true if index is valid and data was written.
    pub fn mt_inventory_scanner_get_added(
        handle: InventoryScannerHandle,
        index: usize,
        out_path: *mut [u8; 4096],
        out_path_len: *mut u32,
        out_fp: *mut FileFingerprint,
    ) -> bool;

    /// Get a modified file entry by index.
    /// Returns true if index is valid and data was written.
    pub fn mt_inventory_scanner_get_modified(
        handle: InventoryScannerHandle,
        index: usize,
        out_path: *mut [u8; 4096],
        out_path_len: *mut u32,
        out_fp: *mut FileFingerprint,
    ) -> bool;

    /// Get an unchanged file path by index.
    /// Returns true if index is valid and data was written.
    pub fn mt_inventory_scanner_get_unchanged(
        handle: InventoryScannerHandle,
        index: usize,
        out_path: *mut [u8; 4096],
        out_path_len: *mut u32,
    ) -> bool;

    /// Get a deleted file path by index.
    /// Returns true if index is valid and data was written.
    pub fn mt_inventory_scanner_get_deleted(
        handle: InventoryScannerHandle,
        index: usize,
        out_path: *mut [u8; 4096],
        out_path_len: *mut u32,
    ) -> bool;

    /// Get scan statistics.
    pub fn mt_inventory_scanner_get_stats(handle: InventoryScannerHandle, out_stats: *mut ScanStats);

    /// Free the inventory scanner and all associated resources.
    pub fn mt_inventory_scanner_free(handle: InventoryScannerHandle);
}

// ============================================================================
// Tests
// ============================================================================

// ============================================================================
// Database Model Types (matching zig-core/src/db/models.zig)
// ============================================================================

/// Track model - represents a music file in the library
#[repr(C)]
#[derive(Debug, Clone)]
pub struct Track {
    pub id: i64,
    pub filepath: [u8; 4096],
    pub filepath_len: u32,
    pub title: [u8; 512],
    pub title_len: u32,
    pub artist: [u8; 512],
    pub artist_len: u32,
    pub album: [u8; 512],
    pub album_len: u32,
    pub album_artist: [u8; 512],
    pub album_artist_len: u32,
    pub track_number: [u8; 32],
    pub track_number_len: u32,
    pub track_total: [u8; 32],
    pub track_total_len: u32,
    pub date: [u8; 32],
    pub date_len: u32,
    pub genre: [u8; 256],
    pub genre_len: u32,
    pub duration_secs: f64,
    pub file_size: i64,
    pub file_mtime_ns: i64,
    pub file_inode: i64,
    pub content_hash: [u8; 64],
    pub content_hash_len: u32,
    pub added_date: i64,
    pub last_played: i64,
    pub play_count: u32,
    pub lastfm_loved: bool,
    pub missing: bool,
    pub last_seen_at: i64,
}

impl Track {
    pub fn get_filepath(&self) -> &str {
        std::str::from_utf8(&self.filepath[..self.filepath_len as usize]).unwrap_or("")
    }

    pub fn get_title(&self) -> &str {
        std::str::from_utf8(&self.title[..self.title_len as usize]).unwrap_or("")
    }

    pub fn get_artist(&self) -> &str {
        std::str::from_utf8(&self.artist[..self.artist_len as usize]).unwrap_or("")
    }

    pub fn get_album(&self) -> &str {
        std::str::from_utf8(&self.album[..self.album_len as usize]).unwrap_or("")
    }
}

/// Playlist model
#[repr(C)]
#[derive(Debug, Clone)]
pub struct Playlist {
    pub id: i64,
    pub name: [u8; 512],
    pub name_len: u32,
    pub position: u32,
    pub created_at: i64,
}

impl Playlist {
    pub fn get_name(&self) -> &str {
        std::str::from_utf8(&self.name[..self.name_len as usize]).unwrap_or("")
    }
}

/// Queue item model
#[repr(C)]
#[derive(Debug, Clone)]
pub struct QueueItem {
    pub id: i64,
    pub filepath: [u8; 4096],
    pub filepath_len: u32,
}

impl QueueItem {
    pub fn get_filepath(&self) -> &str {
        std::str::from_utf8(&self.filepath[..self.filepath_len as usize]).unwrap_or("")
    }
}

/// Search parameters
#[repr(C)]
#[derive(Debug, Clone)]
pub struct SearchParams {
    pub query: [u8; 512],
    pub query_len: u32,
    pub limit: u32,
    pub offset: u32,
    pub sort_by: u8,
    pub sort_order: u8,
}

impl SearchParams {
    pub fn get_query(&self) -> &str {
        std::str::from_utf8(&self.query[..self.query_len as usize]).unwrap_or("")
    }
}

/// Queue snapshot
#[repr(C)]
#[derive(Debug, Clone)]
pub struct QueueSnapshot {
    pub current_position: u32,
    pub total_items: u32,
    pub shuffle_enabled: bool,
    pub repeat_mode: u8,
    pub current_track_id: i64,
}

/// Playlist info
#[repr(C)]
#[derive(Debug, Clone)]
pub struct PlaylistInfo {
    pub id: i64,
    pub name: [u8; 256],
    pub name_len: u32,
    pub track_count: u32,
    pub total_duration: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl PlaylistInfo {
    pub fn get_name(&self) -> &str {
        std::str::from_utf8(&self.name[..self.name_len as usize]).unwrap_or("")
    }
}

/// Setting entry
#[repr(C)]
#[derive(Debug, Clone)]
pub struct SettingEntry {
    pub key: [u8; 128],
    pub key_len: u32,
    pub value: [u8; 4096],
    pub value_len: u32,
}

impl SettingEntry {
    pub fn get_key(&self) -> &str {
        std::str::from_utf8(&self.key[..self.key_len as usize]).unwrap_or("")
    }

    pub fn get_value(&self) -> &str {
        std::str::from_utf8(&self.value[..self.value_len as usize]).unwrap_or("")
    }
}

/// Scrobble record
#[repr(C)]
#[derive(Debug, Clone)]
pub struct ScrobbleRecord {
    pub id: i64,
    pub track_id: i64,
    pub artist: [u8; 512],
    pub artist_len: u32,
    pub track: [u8; 512],
    pub track_len: u32,
    pub album: [u8; 512],
    pub album_len: u32,
    pub timestamp: i64,
    pub duration: i32,
    pub submitted: bool,
}

impl ScrobbleRecord {
    pub fn get_artist(&self) -> &str {
        std::str::from_utf8(&self.artist[..self.artist_len as usize]).unwrap_or("")
    }

    pub fn get_track(&self) -> &str {
        std::str::from_utf8(&self.track[..self.track_len as usize]).unwrap_or("")
    }

    pub fn get_album(&self) -> &str {
        std::str::from_utf8(&self.album[..self.album_len as usize]).unwrap_or("")
    }
}

/// Watched folder
#[repr(C)]
#[derive(Debug, Clone)]
pub struct WatchedFolderFFI {
    pub id: i64,
    pub path: [u8; 4096],
    pub path_len: u32,
    pub scan_mode: u8,
    pub enabled: bool,
    pub last_scan: i64,
    pub track_count: u32,
}

impl WatchedFolderFFI {
    pub fn get_path(&self) -> &str {
        std::str::from_utf8(&self.path[..self.path_len as usize]).unwrap_or("")
    }
}

// ============================================================================
// Last.fm FFI Type Definitions
// ============================================================================

/// Last.fm scrobble request (for track.scrobble API call)
#[repr(C)]
#[derive(Debug, Clone)]
pub struct LastfmScrobbleRequest {
    pub artist: [u8; 512],
    pub artist_len: u32,
    pub track: [u8; 512],
    pub track_len: u32,
    pub album: [u8; 512],
    pub album_len: u32,
    pub timestamp: i64,
    pub duration: i32,
    pub track_number: u32,
}

impl LastfmScrobbleRequest {
    pub fn get_artist(&self) -> &str {
        std::str::from_utf8(&self.artist[..self.artist_len as usize]).unwrap_or("")
    }

    pub fn get_track(&self) -> &str {
        std::str::from_utf8(&self.track[..self.track_len as usize]).unwrap_or("")
    }

    pub fn get_album(&self) -> &str {
        std::str::from_utf8(&self.album[..self.album_len as usize]).unwrap_or("")
    }
}

/// Last.fm now playing request (for track.updateNowPlaying API call)
#[repr(C)]
#[derive(Debug, Clone)]
pub struct LastfmNowPlayingRequest {
    pub artist: [u8; 512],
    pub artist_len: u32,
    pub track: [u8; 512],
    pub track_len: u32,
    pub album: [u8; 512],
    pub album_len: u32,
    pub duration: i32,
    pub track_number: u32,
}

impl LastfmNowPlayingRequest {
    pub fn get_artist(&self) -> &str {
        std::str::from_utf8(&self.artist[..self.artist_len as usize]).unwrap_or("")
    }

    pub fn get_track(&self) -> &str {
        std::str::from_utf8(&self.track[..self.track_len as usize]).unwrap_or("")
    }

    pub fn get_album(&self) -> &str {
        std::str::from_utf8(&self.album[..self.album_len as usize]).unwrap_or("")
    }
}

/// Last.fm built request (ready for HTTP execution)
#[repr(C)]
#[derive(Debug, Clone)]
pub struct LastfmBuiltRequest {
    pub body: [u8; 8192],
    pub body_len: u32,
    pub method: [u8; 16],
    pub method_len: u32,
    pub api_method: [u8; 64],
    pub api_method_len: u32,
}

impl LastfmBuiltRequest {
    pub fn get_body(&self) -> &str {
        std::str::from_utf8(&self.body[..self.body_len as usize]).unwrap_or("")
    }

    pub fn get_method(&self) -> &str {
        std::str::from_utf8(&self.method[..self.method_len as usize]).unwrap_or("")
    }

    pub fn get_api_method(&self) -> &str {
        std::str::from_utf8(&self.api_method[..self.api_method_len as usize]).unwrap_or("")
    }
}

/// Last.fm API response
#[repr(C)]
#[derive(Debug, Clone)]
pub struct LastfmApiResponse {
    pub success: bool,
    pub error_code: u32,
    pub error_message: [u8; 512],
    pub error_message_len: u32,
}

impl LastfmApiResponse {
    pub fn get_error_message(&self) -> &str {
        std::str::from_utf8(&self.error_message[..self.error_message_len as usize]).unwrap_or("")
    }
}

/// Opaque handle to Last.fm client (managed by Zig)
#[repr(C)]
pub struct LastfmClient {
    _private: [u8; 0],
}

// ============================================================================
// Database FFI Function Declarations
// ============================================================================

unsafe extern "C" {
    // Track functions
    pub fn mt_track_new() -> Track;
    pub fn mt_track_set_filepath(track: *mut Track, path: *const c_char);
    pub fn mt_track_set_title(track: *mut Track, title: *const c_char);
    pub fn mt_track_set_artist(track: *mut Track, artist: *const c_char);
    pub fn mt_track_set_album(track: *mut Track, album: *const c_char);
    pub fn mt_track_validate(track: *const Track) -> bool;
    pub fn mt_track_normalize(track: *mut Track);

    // Search params functions
    pub fn mt_search_params_new() -> SearchParams;
    pub fn mt_search_params_set_query(params: *mut SearchParams, query: *const c_char);
    pub fn mt_search_params_set_limit(params: *mut SearchParams, limit: u32);
    pub fn mt_search_params_set_offset(params: *mut SearchParams, offset: u32);
    pub fn mt_search_params_set_sort_by(params: *mut SearchParams, sort_by: u8);
    pub fn mt_search_params_set_sort_order(params: *mut SearchParams, sort_order: u8);

    // Queue manager functions
    pub fn mt_queue_calculate_move(
        from_pos: u32,
        to_pos: u32,
        total_items: u32,
        out_shift_start: *mut u32,
        out_shift_end: *mut u32,
        out_shift_direction: *mut u8,
    ) -> bool;
    pub fn mt_queue_build_shuffle_order(
        count: u32,
        current_position: u32,
        random_seed: u64,
        out_order: *mut *mut u32,
        out_len: *mut u32,
    ) -> bool;
    pub fn mt_queue_free_shuffle_order(order: *mut u32, len: u32);

    // Playlist functions
    pub fn mt_playlist_new() -> Playlist;
    pub fn mt_playlist_set_name(playlist: *mut Playlist, name: *const c_char);
    pub fn mt_playlist_info_new() -> PlaylistInfo;
    pub fn mt_playlist_info_set_name(info: *mut PlaylistInfo, name: *const c_char);

    // Settings functions
    pub fn mt_setting_new() -> SettingEntry;
    pub fn mt_setting_set_key(entry: *mut SettingEntry, key: *const c_char);
    pub fn mt_setting_set_value(entry: *mut SettingEntry, value: *const c_char);
    pub fn mt_setting_parse_bool(value: *const c_char, out_value: *mut bool) -> bool;
    pub fn mt_setting_parse_i32(value: *const c_char, out_value: *mut i32) -> bool;
    pub fn mt_setting_parse_f32(value: *const c_char, out_value: *mut f32) -> bool;

    // Scrobble functions
    pub fn mt_scrobble_new() -> ScrobbleRecord;
    pub fn mt_scrobble_set_artist(record: *mut ScrobbleRecord, artist: *const c_char);
    pub fn mt_scrobble_set_track(record: *mut ScrobbleRecord, track: *const c_char);
    pub fn mt_scrobble_set_album(record: *mut ScrobbleRecord, album: *const c_char);
    pub fn mt_scrobble_is_eligible(played_duration: i32, track_duration: i32) -> bool;

    // Watched folder functions
    pub fn mt_watched_folder_new() -> WatchedFolderFFI;
    pub fn mt_watched_folder_set_path(folder: *mut WatchedFolderFFI, path: *const c_char);
    pub fn mt_watched_folder_set_scan_mode(folder: *mut WatchedFolderFFI, mode: u8);

    // Queue item functions
    pub fn mt_queue_item_new() -> QueueItem;
    pub fn mt_queue_item_set_filepath(item: *mut QueueItem, path: *const c_char);
    pub fn mt_queue_snapshot_new() -> QueueSnapshot;

    // ========================================================================
    // Last.fm FFI Functions
    // ========================================================================

    // Scrobble request functions
    pub fn mt_lastfm_scrobble_request_new() -> LastfmScrobbleRequest;
    pub fn mt_lastfm_scrobble_set_artist(req: *mut LastfmScrobbleRequest, artist: *const c_char);
    pub fn mt_lastfm_scrobble_set_track(req: *mut LastfmScrobbleRequest, track: *const c_char);
    pub fn mt_lastfm_scrobble_set_album(req: *mut LastfmScrobbleRequest, album: *const c_char);
    pub fn mt_lastfm_scrobble_set_timestamp(req: *mut LastfmScrobbleRequest, timestamp: i64);
    pub fn mt_lastfm_scrobble_set_duration(req: *mut LastfmScrobbleRequest, duration: i32);
    pub fn mt_lastfm_scrobble_set_track_number(req: *mut LastfmScrobbleRequest, track_number: u32);

    // Now playing request functions
    pub fn mt_lastfm_now_playing_request_new() -> LastfmNowPlayingRequest;
    pub fn mt_lastfm_now_playing_set_artist(req: *mut LastfmNowPlayingRequest, artist: *const c_char);
    pub fn mt_lastfm_now_playing_set_track(req: *mut LastfmNowPlayingRequest, track: *const c_char);
    pub fn mt_lastfm_now_playing_set_album(req: *mut LastfmNowPlayingRequest, album: *const c_char);
    pub fn mt_lastfm_now_playing_set_duration(req: *mut LastfmNowPlayingRequest, duration: i32);
    pub fn mt_lastfm_now_playing_set_track_number(req: *mut LastfmNowPlayingRequest, track_number: u32);

    // Client lifecycle functions
    pub fn mt_lastfm_client_new(api_key: *const c_char, api_secret: *const c_char) -> *mut LastfmClient;
    pub fn mt_lastfm_client_free(client: *mut LastfmClient);
    pub fn mt_lastfm_client_set_session_key(client: *mut LastfmClient, session_key: *const c_char);
    pub fn mt_lastfm_client_clear_session_key(client: *mut LastfmClient);
    pub fn mt_lastfm_client_is_authenticated(client: *const LastfmClient) -> bool;

    // Client request building functions
    pub fn mt_lastfm_client_build_scrobble(
        client: *mut LastfmClient,
        scrobble: *const LastfmScrobbleRequest,
        out_request: *mut LastfmBuiltRequest,
    ) -> bool;
    pub fn mt_lastfm_client_build_now_playing(
        client: *mut LastfmClient,
        now_playing: *const LastfmNowPlayingRequest,
        out_request: *mut LastfmBuiltRequest,
    ) -> bool;

    // Client rate limiting functions
    pub fn mt_lastfm_client_wait_for_rate_limit(client: *mut LastfmClient);
    pub fn mt_lastfm_client_get_wait_time_ns(client: *mut LastfmClient) -> u64;
    pub fn mt_lastfm_client_record_request(client: *mut LastfmClient);

    // Signature generation
    pub fn mt_lastfm_generate_signature(
        pairs: *const *const c_char,
        count: u32,
        api_secret: *const c_char,
        out_sig: *mut u8,
    ) -> bool;

    // Response helpers
    pub fn mt_lastfm_response_success() -> LastfmApiResponse;
    pub fn mt_lastfm_response_error(error_code: u32, message: *const c_char) -> LastfmApiResponse;
    pub fn mt_lastfm_built_request_new() -> LastfmBuiltRequest;
    pub fn mt_lastfm_get_api_url() -> *const c_char;
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::{CStr, CString};

    #[test]
    fn test_version() {
        unsafe {
            let version_ptr = mt_version();
            let version = CStr::from_ptr(version_ptr).to_str().unwrap();
            assert_eq!(version, "0.1.0");
        }
    }

    #[test]
    fn test_is_audio_file() {
        unsafe {
            // Test supported extensions
            let mp3 = CString::new("song.mp3").unwrap();
            assert!(mt_is_audio_file(mp3.as_ptr()));

            let flac = CString::new("track.flac").unwrap();
            assert!(mt_is_audio_file(flac.as_ptr()));

            let m4a = CString::new("audio.m4a").unwrap();
            assert!(mt_is_audio_file(m4a.as_ptr()));

            // Test case insensitivity
            let mp3_upper = CString::new("SONG.MP3").unwrap();
            assert!(mt_is_audio_file(mp3_upper.as_ptr()));

            // Test unsupported extensions
            let jpg = CString::new("image.jpg").unwrap();
            assert!(!mt_is_audio_file(jpg.as_ptr()));

            let txt = CString::new("readme.txt").unwrap();
            assert!(!mt_is_audio_file(txt.as_ptr()));
        }
    }

    #[test]
    fn test_fingerprint_matches() {
        let fp1 = FileFingerprint {
            mtime_ns: 1234567890,
            size: 1000,
            inode: 12345,
            has_mtime: true,
            has_inode: true,
        };

        let fp2 = FileFingerprint {
            mtime_ns: 1234567890,
            size: 1000,
            inode: 99999, // Different inode - should still match
            has_mtime: true,
            has_inode: true,
        };

        let fp3 = FileFingerprint {
            mtime_ns: 1234567890,
            size: 2000, // Different size
            inode: 12345,
            has_mtime: true,
            has_inode: true,
        };

        assert!(fp1.matches(&fp2));
        assert!(!fp1.matches(&fp3));

        // Test FFI function
        unsafe {
            assert!(mt_fingerprint_matches(&fp1, &fp2));
            assert!(!mt_fingerprint_matches(&fp1, &fp3));
        }
    }

    #[test]
    fn test_extract_metadata_into_nonexistent() {
        unsafe {
            let path = CString::new("/nonexistent/path.mp3").unwrap();
            let mut metadata = std::mem::zeroed::<ExtractedMetadata>();

            let success = mt_extract_metadata_into(path.as_ptr(), &mut metadata);

            // Should fail for nonexistent file
            assert!(!success);
            assert!(!metadata.is_valid);
        }
    }

    #[test]
    fn test_inventory_scanner_creation() {
        unsafe {
            let handle = mt_inventory_scanner_new();
            assert!(!handle.is_null());
            mt_inventory_scanner_free(handle);
        }
    }

    #[test]
    fn test_inventory_scanner_add_path() {
        unsafe {
            let handle = mt_inventory_scanner_new();
            assert!(!handle.is_null());

            let path = CString::new("/test/path").unwrap();
            let success = mt_inventory_scanner_add_path(handle, path.as_ptr());
            assert!(success);

            mt_inventory_scanner_free(handle);
        }
    }

    #[test]
    fn test_inventory_scanner_add_db_fingerprint() {
        unsafe {
            let handle = mt_inventory_scanner_new();
            assert!(!handle.is_null());

            let path = CString::new("/test/song.mp3").unwrap();
            let fp = FileFingerprint {
                mtime_ns: 1234567890,
                size: 1000,
                inode: 0,
                has_mtime: true,
                has_inode: false,
            };
            let success = mt_inventory_scanner_add_db_fingerprint(handle, path.as_ptr(), &fp);
            assert!(success);

            mt_inventory_scanner_free(handle);
        }
    }

    #[test]
    fn test_inventory_scanner_empty_scan() {
        unsafe {
            let handle = mt_inventory_scanner_new();
            assert!(!handle.is_null());

            // Add a nonexistent path
            let path = CString::new("/nonexistent/path/that/does/not/exist").unwrap();
            mt_inventory_scanner_add_path(handle, path.as_ptr());

            // Run scan
            let success = mt_inventory_scanner_run(handle, None);
            assert!(success);

            // Should have no results for nonexistent path
            assert_eq!(mt_inventory_scanner_get_added_count(handle), 0);
            assert_eq!(mt_inventory_scanner_get_modified_count(handle), 0);
            assert_eq!(mt_inventory_scanner_get_unchanged_count(handle), 0);
            assert_eq!(mt_inventory_scanner_get_deleted_count(handle), 0);

            mt_inventory_scanner_free(handle);
        }
    }

    // ========================================================================
    // Database FFI Tests
    // ========================================================================

    #[test]
    fn test_track_creation() {
        unsafe {
            let mut track = mt_track_new();
            assert_eq!(track.id, 0);

            let path = CString::new("/music/test.mp3").unwrap();
            mt_track_set_filepath(&mut track, path.as_ptr());
            assert_eq!(track.get_filepath(), "/music/test.mp3");

            let title = CString::new("Test Song").unwrap();
            mt_track_set_title(&mut track, title.as_ptr());
            assert_eq!(track.get_title(), "Test Song");

            let artist = CString::new("Test Artist").unwrap();
            mt_track_set_artist(&mut track, artist.as_ptr());
            assert_eq!(track.get_artist(), "Test Artist");

            let album = CString::new("Test Album").unwrap();
            mt_track_set_album(&mut track, album.as_ptr());
            assert_eq!(track.get_album(), "Test Album");

            // Should validate successfully
            assert!(mt_track_validate(&track));
        }
    }

    #[test]
    fn test_track_validation_fails() {
        unsafe {
            let track = mt_track_new();
            // Empty track should not validate
            assert!(!mt_track_validate(&track));
        }
    }

    #[test]
    fn test_search_params() {
        unsafe {
            let mut params = mt_search_params_new();
            assert_eq!(params.limit, 100); // Default limit

            let query = CString::new("beatles").unwrap();
            mt_search_params_set_query(&mut params, query.as_ptr());
            assert_eq!(params.get_query(), "beatles");

            mt_search_params_set_limit(&mut params, 50);
            assert_eq!(params.limit, 50);

            mt_search_params_set_offset(&mut params, 10);
            assert_eq!(params.offset, 10);

            mt_search_params_set_sort_by(&mut params, 1); // artist
            assert_eq!(params.sort_by, 1);

            mt_search_params_set_sort_order(&mut params, 1); // descending
            assert_eq!(params.sort_order, 1);
        }
    }

    #[test]
    fn test_queue_calculate_move() {
        unsafe {
            let mut shift_start: u32 = 0;
            let mut shift_end: u32 = 0;
            let mut shift_direction: u8 = 0;

            let success = mt_queue_calculate_move(
                2,
                5,
                10,
                &mut shift_start,
                &mut shift_end,
                &mut shift_direction,
            );

            assert!(success);
            assert_eq!(shift_start, 2);
            assert_eq!(shift_end, 5);
            assert_eq!(shift_direction, 2); // down
        }
    }

    #[test]
    fn test_queue_calculate_move_invalid() {
        unsafe {
            let mut shift_start: u32 = 0;
            let mut shift_end: u32 = 0;
            let mut shift_direction: u8 = 0;

            // Invalid position (15 >= 10)
            let success = mt_queue_calculate_move(
                15,
                3,
                10,
                &mut shift_start,
                &mut shift_end,
                &mut shift_direction,
            );

            assert!(!success);
        }
    }

    #[test]
    fn test_playlist_creation() {
        unsafe {
            let mut playlist = mt_playlist_new();
            assert_eq!(playlist.id, 0);

            let name = CString::new("My Playlist").unwrap();
            mt_playlist_set_name(&mut playlist, name.as_ptr());
            assert_eq!(playlist.get_name(), "My Playlist");
        }
    }

    #[test]
    fn test_playlist_info_creation() {
        unsafe {
            let mut info = mt_playlist_info_new();
            assert_eq!(info.id, 0);
            assert_eq!(info.track_count, 0);

            let name = CString::new("Info Playlist").unwrap();
            mt_playlist_info_set_name(&mut info, name.as_ptr());
            assert_eq!(info.get_name(), "Info Playlist");
        }
    }

    #[test]
    fn test_setting_entry() {
        unsafe {
            let mut entry = mt_setting_new();
            assert_eq!(entry.key_len, 0);
            assert_eq!(entry.value_len, 0);

            let key = CString::new("volume").unwrap();
            mt_setting_set_key(&mut entry, key.as_ptr());
            assert_eq!(entry.get_key(), "volume");

            let value = CString::new("75").unwrap();
            mt_setting_set_value(&mut entry, value.as_ptr());
            assert_eq!(entry.get_value(), "75");
        }
    }

    #[test]
    fn test_setting_parse_bool() {
        unsafe {
            let mut out_val: bool = false;

            let true_str = CString::new("true").unwrap();
            assert!(mt_setting_parse_bool(true_str.as_ptr(), &mut out_val));
            assert!(out_val);

            let false_str = CString::new("false").unwrap();
            assert!(mt_setting_parse_bool(false_str.as_ptr(), &mut out_val));
            assert!(!out_val);

            let invalid = CString::new("invalid").unwrap();
            assert!(!mt_setting_parse_bool(invalid.as_ptr(), &mut out_val));
        }
    }

    #[test]
    fn test_setting_parse_i32() {
        unsafe {
            let mut out_val: i32 = 0;

            let val = CString::new("42").unwrap();
            assert!(mt_setting_parse_i32(val.as_ptr(), &mut out_val));
            assert_eq!(out_val, 42);

            let neg = CString::new("-10").unwrap();
            assert!(mt_setting_parse_i32(neg.as_ptr(), &mut out_val));
            assert_eq!(out_val, -10);

            let invalid = CString::new("not_a_number").unwrap();
            assert!(!mt_setting_parse_i32(invalid.as_ptr(), &mut out_val));
        }
    }

    #[test]
    fn test_setting_parse_f32() {
        unsafe {
            let mut out_val: f32 = 0.0;

            let val = CString::new("3.14").unwrap();
            assert!(mt_setting_parse_f32(val.as_ptr(), &mut out_val));
            assert!((out_val - 3.14).abs() < 0.001);

            let invalid = CString::new("invalid").unwrap();
            assert!(!mt_setting_parse_f32(invalid.as_ptr(), &mut out_val));
        }
    }

    #[test]
    fn test_scrobble_record() {
        unsafe {
            let mut record = mt_scrobble_new();
            assert_eq!(record.id, 0);
            assert!(!record.submitted);

            let artist = CString::new("The Beatles").unwrap();
            mt_scrobble_set_artist(&mut record, artist.as_ptr());
            assert_eq!(record.get_artist(), "The Beatles");

            let track = CString::new("Hey Jude").unwrap();
            mt_scrobble_set_track(&mut record, track.as_ptr());
            assert_eq!(record.get_track(), "Hey Jude");

            let album = CString::new("Past Masters").unwrap();
            mt_scrobble_set_album(&mut record, album.as_ptr());
            assert_eq!(record.get_album(), "Past Masters");
        }
    }

    #[test]
    fn test_scrobble_eligibility() {
        unsafe {
            // 4 minutes played on 10 minute track - eligible
            assert!(mt_scrobble_is_eligible(240, 600));

            // 2 minutes played on 3 minute track - eligible (>50%)
            assert!(mt_scrobble_is_eligible(120, 180));

            // 1 minute played on 10 minute track - not eligible
            assert!(!mt_scrobble_is_eligible(60, 600));

            // Edge cases
            assert!(!mt_scrobble_is_eligible(0, 300));
            assert!(!mt_scrobble_is_eligible(300, 0));
        }
    }

    #[test]
    fn test_watched_folder() {
        unsafe {
            let mut folder = mt_watched_folder_new();
            assert!(folder.enabled);

            let path = CString::new("/home/user/music").unwrap();
            mt_watched_folder_set_path(&mut folder, path.as_ptr());
            assert_eq!(folder.get_path(), "/home/user/music");

            mt_watched_folder_set_scan_mode(&mut folder, 2); // watch mode
            assert_eq!(folder.scan_mode, 2);
        }
    }

    #[test]
    fn test_queue_item() {
        unsafe {
            let mut item = mt_queue_item_new();
            assert_eq!(item.id, 0);

            let path = CString::new("/music/song.flac").unwrap();
            mt_queue_item_set_filepath(&mut item, path.as_ptr());
            assert_eq!(item.get_filepath(), "/music/song.flac");
        }
    }

    #[test]
    fn test_queue_snapshot() {
        unsafe {
            let snapshot = mt_queue_snapshot_new();
            assert_eq!(snapshot.current_position, 0);
            assert_eq!(snapshot.total_items, 0);
            assert!(!snapshot.shuffle_enabled);
            assert_eq!(snapshot.repeat_mode, 0); // off
        }
    }

    // ========================================================================
    // Last.fm FFI Tests
    // ========================================================================

    #[test]
    fn test_lastfm_scrobble_request() {
        unsafe {
            let mut req = mt_lastfm_scrobble_request_new();
            assert_eq!(req.artist_len, 0);
            assert_eq!(req.track_len, 0);
            assert_eq!(req.timestamp, 0);

            let artist = CString::new("The Beatles").unwrap();
            mt_lastfm_scrobble_set_artist(&mut req, artist.as_ptr());
            assert_eq!(req.get_artist(), "The Beatles");

            let track = CString::new("Hey Jude").unwrap();
            mt_lastfm_scrobble_set_track(&mut req, track.as_ptr());
            assert_eq!(req.get_track(), "Hey Jude");

            let album = CString::new("White Album").unwrap();
            mt_lastfm_scrobble_set_album(&mut req, album.as_ptr());
            assert_eq!(req.get_album(), "White Album");

            mt_lastfm_scrobble_set_timestamp(&mut req, 1234567890);
            assert_eq!(req.timestamp, 1234567890);

            mt_lastfm_scrobble_set_duration(&mut req, 240);
            assert_eq!(req.duration, 240);

            mt_lastfm_scrobble_set_track_number(&mut req, 5);
            assert_eq!(req.track_number, 5);
        }
    }

    #[test]
    fn test_lastfm_now_playing_request() {
        unsafe {
            let mut req = mt_lastfm_now_playing_request_new();
            assert_eq!(req.artist_len, 0);
            assert_eq!(req.track_len, 0);

            let artist = CString::new("Pink Floyd").unwrap();
            mt_lastfm_now_playing_set_artist(&mut req, artist.as_ptr());
            assert_eq!(req.get_artist(), "Pink Floyd");

            let track = CString::new("Comfortably Numb").unwrap();
            mt_lastfm_now_playing_set_track(&mut req, track.as_ptr());
            assert_eq!(req.get_track(), "Comfortably Numb");

            let album = CString::new("The Wall").unwrap();
            mt_lastfm_now_playing_set_album(&mut req, album.as_ptr());
            assert_eq!(req.get_album(), "The Wall");

            mt_lastfm_now_playing_set_duration(&mut req, 382);
            assert_eq!(req.duration, 382);

            mt_lastfm_now_playing_set_track_number(&mut req, 6);
            assert_eq!(req.track_number, 6);
        }
    }

    #[test]
    fn test_lastfm_client_lifecycle() {
        unsafe {
            let api_key = CString::new("test_api_key").unwrap();
            let api_secret = CString::new("test_api_secret").unwrap();

            let client = mt_lastfm_client_new(api_key.as_ptr(), api_secret.as_ptr());
            assert!(!client.is_null());

            // Initially not authenticated
            assert!(!mt_lastfm_client_is_authenticated(client));

            // Set session key
            let session_key = CString::new("test_session_key").unwrap();
            mt_lastfm_client_set_session_key(client, session_key.as_ptr());
            assert!(mt_lastfm_client_is_authenticated(client));

            // Clear session key
            mt_lastfm_client_clear_session_key(client);
            assert!(!mt_lastfm_client_is_authenticated(client));

            mt_lastfm_client_free(client);
        }
    }

    #[test]
    fn test_lastfm_client_build_scrobble() {
        unsafe {
            let api_key = CString::new("test_api_key").unwrap();
            let api_secret = CString::new("test_api_secret").unwrap();

            let client = mt_lastfm_client_new(api_key.as_ptr(), api_secret.as_ptr());
            assert!(!client.is_null());

            // Set session key for authenticated requests
            let session_key = CString::new("test_session").unwrap();
            mt_lastfm_client_set_session_key(client, session_key.as_ptr());

            // Create scrobble request
            let mut scrobble = mt_lastfm_scrobble_request_new();
            let artist = CString::new("Test Artist").unwrap();
            let track = CString::new("Test Track").unwrap();
            mt_lastfm_scrobble_set_artist(&mut scrobble, artist.as_ptr());
            mt_lastfm_scrobble_set_track(&mut scrobble, track.as_ptr());
            mt_lastfm_scrobble_set_timestamp(&mut scrobble, 1234567890);

            // Build request
            let mut built_request = mt_lastfm_built_request_new();
            let success = mt_lastfm_client_build_scrobble(client, &scrobble, &mut built_request);
            assert!(success);
            assert!(built_request.body_len > 0);
            assert_eq!(built_request.get_api_method(), "track.scrobble");
            assert_eq!(built_request.get_method(), "POST");

            // Verify body contains expected params
            let body = built_request.get_body();
            assert!(body.contains("api_key=test_api_key"));
            assert!(body.contains("method=track.scrobble"));
            assert!(body.contains("api_sig="));
            assert!(body.contains("format=json"));

            mt_lastfm_client_free(client);
        }
    }

    #[test]
    fn test_lastfm_client_rate_limiting() {
        unsafe {
            let api_key = CString::new("test_api_key").unwrap();
            let api_secret = CString::new("test_api_secret").unwrap();

            let client = mt_lastfm_client_new(api_key.as_ptr(), api_secret.as_ptr());
            assert!(!client.is_null());

            // First request should have no wait
            let wait_time = mt_lastfm_client_get_wait_time_ns(client);
            assert!(wait_time == 0 || wait_time < 1_000_000); // less than 1ms

            mt_lastfm_client_free(client);
        }
    }

    #[test]
    fn test_lastfm_response() {
        unsafe {
            // Test success response
            let success_resp = mt_lastfm_response_success();
            assert!(success_resp.success);
            assert_eq!(success_resp.error_code, 0);

            // Test error response
            let message = CString::new("Authentication Failed").unwrap();
            let error_resp = mt_lastfm_response_error(4, message.as_ptr());
            assert!(!error_resp.success);
            assert_eq!(error_resp.error_code, 4);
            assert_eq!(error_resp.get_error_message(), "Authentication Failed");
        }
    }

    #[test]
    fn test_lastfm_built_request() {
        unsafe {
            let req = mt_lastfm_built_request_new();
            assert_eq!(req.body_len, 0);
            assert_eq!(req.get_method(), "POST");
        }
    }

    #[test]
    fn test_lastfm_api_url() {
        unsafe {
            let url_ptr = mt_lastfm_get_api_url();
            let url = CStr::from_ptr(url_ptr).to_str().unwrap();
            assert!(url.starts_with("https://ws.audioscrobbler.com"));
        }
    }
}
