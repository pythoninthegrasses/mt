//! FFI exports for Rust/Tauri integration
//!
//! All functions use C ABI and fixed-size types for safe FFI.

const std = @import("std");
const types = @import("types.zig");
const scanner = @import("scanner/scanner.zig");
const metadata = @import("scanner/metadata.zig");

const ExtractedMetadata = types.ExtractedMetadata;
const FileFingerprint = types.FileFingerprint;
const ScanStats = types.ScanStats;

// Use a general purpose allocator for FFI allocations
var gpa = std.heap.GeneralPurposeAllocator(.{}){};

// ============================================================================
// Scanner FFI
// ============================================================================

/// Extract metadata from a single file.
/// Returns a pointer to ExtractedMetadata that must be freed with mt_free_metadata.
export fn mt_extract_metadata(path_ptr: [*:0]const u8) callconv(.C) ?*ExtractedMetadata {
    const path = std.mem.span(path_ptr);

    const result = gpa.allocator().create(ExtractedMetadata) catch return null;
    result.* = metadata.extractMetadata(path);

    return result;
}

/// Free metadata returned by mt_extract_metadata
export fn mt_free_metadata(ptr: ?*ExtractedMetadata) callconv(.C) void {
    if (ptr) |p| {
        gpa.allocator().destroy(p);
    }
}

/// Extract metadata into a caller-provided buffer (no allocation).
/// Returns true on success.
export fn mt_extract_metadata_into(
    path_ptr: [*:0]const u8,
    out: *ExtractedMetadata,
) callconv(.C) bool {
    const path = std.mem.span(path_ptr);
    out.* = metadata.extractMetadata(path);
    return out.is_valid;
}

/// Batch extract metadata from multiple files.
/// Caller provides arrays for paths and results.
/// Returns number of successfully extracted files.
export fn mt_extract_metadata_batch(
    paths: [*]const [*:0]const u8,
    count: usize,
    results: [*]ExtractedMetadata,
) callconv(.C) usize {
    var success_count: usize = 0;

    for (0..count) |i| {
        const path = std.mem.span(paths[i]);
        results[i] = metadata.extractMetadata(path);
        if (results[i].is_valid) {
            success_count += 1;
        }
    }

    return success_count;
}

/// Check if a file has a supported audio extension
export fn mt_is_audio_file(path_ptr: [*:0]const u8) callconv(.C) bool {
    const path = std.mem.span(path_ptr);
    return types.isAudioFile(path);
}

// ============================================================================
// Fingerprint FFI
// ============================================================================

/// Get file fingerprint from path.
/// Returns true on success, populates out_fp.
export fn mt_get_fingerprint(
    path_ptr: [*:0]const u8,
    out_fp: *FileFingerprint,
) callconv(.C) bool {
    const path = std.mem.span(path_ptr);

    const fp = @import("scanner/fingerprint.zig").fromPath(path) catch {
        return false;
    };

    out_fp.* = fp;
    return true;
}

/// Compare two fingerprints for equality (ignores inode)
export fn mt_fingerprint_matches(
    fp1: *const FileFingerprint,
    fp2: *const FileFingerprint,
) callconv(.C) bool {
    return fp1.matches(fp2.*);
}

// ============================================================================
// Memory management
// ============================================================================

/// Allocate a buffer of the given size.
/// Returns null on failure.
export fn mt_alloc(size: usize) callconv(.C) ?[*]u8 {
    const slice = gpa.allocator().alloc(u8, size) catch return null;
    return slice.ptr;
}

/// Free a buffer allocated by mt_alloc.
export fn mt_free(ptr: ?[*]u8, size: usize) callconv(.C) void {
    if (ptr) |p| {
        gpa.allocator().free(p[0..size]);
    }
}

// ============================================================================
// Version info
// ============================================================================

/// Get library version string
export fn mt_version() callconv(.C) [*:0]const u8 {
    return "0.1.0";
}

// ============================================================================
// Artwork Cache FFI
// ============================================================================

const artwork_cache = @import("scanner/artwork_cache.zig");
pub const Artwork = artwork_cache.Artwork;
pub const ArtworkCache = artwork_cache.ArtworkCache;

/// Create new artwork cache with default capacity (100 entries).
/// Returns opaque handle or null on allocation failure.
export fn mt_artwork_cache_new() callconv(.C) ?*ArtworkCache {
    return ArtworkCache.init(gpa.allocator(), artwork_cache.DEFAULT_CACHE_SIZE) catch null;
}

/// Create artwork cache with custom capacity.
/// Returns opaque handle or null on allocation failure.
export fn mt_artwork_cache_new_with_capacity(capacity: usize) callconv(.C) ?*ArtworkCache {
    return ArtworkCache.init(gpa.allocator(), capacity) catch null;
}

/// Get artwork for track, loading from file if not cached.
/// Returns true if artwork was found, false otherwise.
/// The out parameter is populated only when returning true.
export fn mt_artwork_cache_get_or_load(
    cache: ?*ArtworkCache,
    track_id: i64,
    filepath: [*:0]const u8,
    out: *Artwork,
) callconv(.C) bool {
    const c = cache orelse return false;
    if (c.getOrLoad(track_id, filepath)) |artwork| {
        out.* = artwork;
        return true;
    }
    return false;
}

/// Invalidate cache entry for a specific track.
/// Call this when track metadata is updated.
export fn mt_artwork_cache_invalidate(
    cache: ?*ArtworkCache,
    track_id: i64,
) callconv(.C) void {
    const c = cache orelse return;
    c.invalidate(track_id);
}

/// Clear all cache entries.
export fn mt_artwork_cache_clear(cache: ?*ArtworkCache) callconv(.C) void {
    const c = cache orelse return;
    c.clear();
}

/// Get current number of cached items.
export fn mt_artwork_cache_len(cache: ?*ArtworkCache) callconv(.C) usize {
    const c = cache orelse return 0;
    return c.len();
}

/// Free artwork cache and all associated resources.
export fn mt_artwork_cache_free(cache: ?*ArtworkCache) callconv(.C) void {
    const c = cache orelse return;
    c.deinit();
}

// ============================================================================
// Inventory Scanner FFI
// ============================================================================

const inventory = @import("scanner/inventory.zig");

/// Opaque handle for inventory scanner
pub const InventoryScannerHandle = *InventoryScannerState;

/// Internal state for FFI inventory scanner
const InventoryScannerState = struct {
    allocator: std.mem.Allocator,
    paths: std.ArrayList([]const u8),
    db_fingerprints: std.ArrayList(inventory.DbFingerprint),
    result: ?inventory.InventoryResult,
    recursive: bool,

    fn init(allocator: std.mem.Allocator) !*InventoryScannerState {
        const state = try allocator.create(InventoryScannerState);
        state.* = .{
            .allocator = allocator,
            .paths = std.ArrayList([]const u8).init(allocator),
            .db_fingerprints = std.ArrayList(inventory.DbFingerprint).init(allocator),
            .result = null,
            .recursive = true,
        };
        return state;
    }

    fn deinit(self: *InventoryScannerState) void {
        // Free path strings
        for (self.paths.items) |path| {
            self.allocator.free(path);
        }
        self.paths.deinit();

        // Free DB fingerprint path strings
        for (self.db_fingerprints.items) |entry| {
            self.allocator.free(entry.filepath);
        }
        self.db_fingerprints.deinit();

        // Free result if present
        if (self.result) |*result| {
            result.deinit();
        }

        self.allocator.destroy(self);
    }
};

/// Create a new inventory scanner.
/// Returns opaque handle or null on allocation failure.
export fn mt_inventory_scanner_new() callconv(.C) ?*InventoryScannerState {
    return InventoryScannerState.init(gpa.allocator()) catch null;
}

/// Set recursive mode for directory scanning.
export fn mt_inventory_scanner_set_recursive(
    handle: ?*InventoryScannerState,
    recursive: bool,
) callconv(.C) void {
    const s = handle orelse return;
    s.recursive = recursive;
}

/// Add a path to scan.
/// Returns true on success, false on allocation failure.
export fn mt_inventory_scanner_add_path(
    handle: ?*InventoryScannerState,
    path_ptr: [*:0]const u8,
) callconv(.C) bool {
    const s = handle orelse return false;
    const path = std.mem.span(path_ptr);

    // Duplicate the path string
    const path_copy = s.allocator.dupe(u8, path) catch return false;
    s.paths.append(path_copy) catch {
        s.allocator.free(path_copy);
        return false;
    };
    return true;
}

/// Add a database fingerprint for comparison.
/// Returns true on success, false on allocation failure.
export fn mt_inventory_scanner_add_db_fingerprint(
    handle: ?*InventoryScannerState,
    path_ptr: [*:0]const u8,
    fp: *const FileFingerprint,
) callconv(.C) bool {
    const s = handle orelse return false;
    const path = std.mem.span(path_ptr);

    // Duplicate the path string
    const path_copy = s.allocator.dupe(u8, path) catch return false;
    s.db_fingerprints.append(.{
        .filepath = path_copy,
        .fingerprint = fp.*,
    }) catch {
        s.allocator.free(path_copy);
        return false;
    };
    return true;
}

/// Progress callback type for inventory scanning
pub const InventoryProgressCallback = ?*const fn (visited: usize) callconv(.C) void;

/// Run the inventory scan.
/// Returns true on success, false on error.
export fn mt_inventory_scanner_run(
    handle: ?*InventoryScannerState,
    progress_callback: InventoryProgressCallback,
) callconv(.C) bool {
    const s = handle orelse return false;

    // Clear any previous result
    if (s.result) |*result| {
        result.deinit();
        s.result = null;
    }

    // Run inventory
    s.result = inventory.runInventory(
        s.allocator,
        s.paths.items,
        s.db_fingerprints.items,
        s.recursive,
        progress_callback,
    ) catch return false;

    return true;
}

/// Get the count of added files.
export fn mt_inventory_scanner_get_added_count(
    handle: ?*InventoryScannerState,
) callconv(.C) usize {
    const s = handle orelse return 0;
    const result = s.result orelse return 0;
    return result.added.items.len;
}

/// Get the count of modified files.
export fn mt_inventory_scanner_get_modified_count(
    handle: ?*InventoryScannerState,
) callconv(.C) usize {
    const s = handle orelse return 0;
    const result = s.result orelse return 0;
    return result.modified.items.len;
}

/// Get the count of unchanged files.
export fn mt_inventory_scanner_get_unchanged_count(
    handle: ?*InventoryScannerState,
) callconv(.C) usize {
    const s = handle orelse return 0;
    const result = s.result orelse return 0;
    return result.unchanged.items.len;
}

/// Get the count of deleted files.
export fn mt_inventory_scanner_get_deleted_count(
    handle: ?*InventoryScannerState,
) callconv(.C) usize {
    const s = handle orelse return 0;
    const result = s.result orelse return 0;
    return result.deleted.items.len;
}

/// Get an added file entry by index.
/// Returns true if index is valid and data was written.
export fn mt_inventory_scanner_get_added(
    handle: ?*InventoryScannerState,
    index: usize,
    out_path: *[4096]u8,
    out_path_len: *u32,
    out_fp: *FileFingerprint,
) callconv(.C) bool {
    const s = handle orelse return false;
    const result = s.result orelse return false;

    if (index >= result.added.items.len) return false;

    const entry = result.added.items[index];

    // Copy path
    const copy_len = @min(entry.filepath.len, out_path.len);
    @memcpy(out_path[0..copy_len], entry.filepath[0..copy_len]);
    out_path_len.* = @intCast(copy_len);

    // Copy fingerprint
    out_fp.* = entry.fingerprint;

    return true;
}

/// Get a modified file entry by index.
/// Returns true if index is valid and data was written.
export fn mt_inventory_scanner_get_modified(
    handle: ?*InventoryScannerState,
    index: usize,
    out_path: *[4096]u8,
    out_path_len: *u32,
    out_fp: *FileFingerprint,
) callconv(.C) bool {
    const s = handle orelse return false;
    const result = s.result orelse return false;

    if (index >= result.modified.items.len) return false;

    const entry = result.modified.items[index];

    // Copy path
    const copy_len = @min(entry.filepath.len, out_path.len);
    @memcpy(out_path[0..copy_len], entry.filepath[0..copy_len]);
    out_path_len.* = @intCast(copy_len);

    // Copy fingerprint
    out_fp.* = entry.fingerprint;

    return true;
}

/// Get an unchanged file path by index.
/// Returns true if index is valid and data was written.
export fn mt_inventory_scanner_get_unchanged(
    handle: ?*InventoryScannerState,
    index: usize,
    out_path: *[4096]u8,
    out_path_len: *u32,
) callconv(.C) bool {
    const s = handle orelse return false;
    const result = s.result orelse return false;

    if (index >= result.unchanged.items.len) return false;

    const filepath = result.unchanged.items[index];

    // Copy path
    const copy_len = @min(filepath.len, out_path.len);
    @memcpy(out_path[0..copy_len], filepath[0..copy_len]);
    out_path_len.* = @intCast(copy_len);

    return true;
}

/// Get a deleted file path by index.
/// Returns true if index is valid and data was written.
export fn mt_inventory_scanner_get_deleted(
    handle: ?*InventoryScannerState,
    index: usize,
    out_path: *[4096]u8,
    out_path_len: *u32,
) callconv(.C) bool {
    const s = handle orelse return false;
    const result = s.result orelse return false;

    if (index >= result.deleted.items.len) return false;

    const filepath = result.deleted.items[index];

    // Copy path
    const copy_len = @min(filepath.len, out_path.len);
    @memcpy(out_path[0..copy_len], filepath[0..copy_len]);
    out_path_len.* = @intCast(copy_len);

    return true;
}

/// Get scan statistics.
export fn mt_inventory_scanner_get_stats(
    handle: ?*InventoryScannerState,
    out_stats: *ScanStats,
) callconv(.C) void {
    const s = handle orelse {
        out_stats.* = std.mem.zeroes(ScanStats);
        return;
    };
    const result = s.result orelse {
        out_stats.* = std.mem.zeroes(ScanStats);
        return;
    };
    out_stats.* = result.stats;
}

/// Free the inventory scanner and all associated resources.
export fn mt_inventory_scanner_free(handle: ?*InventoryScannerState) callconv(.C) void {
    const s = handle orelse return;
    s.deinit();
}

// ============================================================================
// Tests
// ============================================================================

test "FFI inventory scanner creation" {
    const handle = mt_inventory_scanner_new();
    try std.testing.expect(handle != null);
    mt_inventory_scanner_free(handle);
}

test "FFI inventory scanner add path" {
    const handle = mt_inventory_scanner_new();
    defer mt_inventory_scanner_free(handle);

    const success = mt_inventory_scanner_add_path(handle, "/test/path");
    try std.testing.expect(success);
}

test "FFI inventory scanner add db fingerprint" {
    const handle = mt_inventory_scanner_new();
    defer mt_inventory_scanner_free(handle);

    const fp = FileFingerprint{
        .mtime_ns = 1234567890,
        .size = 1000,
        .inode = 0,
        .has_mtime = true,
        .has_inode = false,
    };
    const success = mt_inventory_scanner_add_db_fingerprint(handle, "/test/song.mp3", &fp);
    try std.testing.expect(success);
}

test "FFI metadata extraction" {
    var m: ExtractedMetadata = undefined;
    const success = mt_extract_metadata_into("/nonexistent/path.mp3", &m);
    try std.testing.expect(!success);
    try std.testing.expect(!m.is_valid);
}

test "FFI is_audio_file" {
    try std.testing.expect(mt_is_audio_file("song.mp3"));
    try std.testing.expect(mt_is_audio_file("track.FLAC"));
    try std.testing.expect(!mt_is_audio_file("image.jpg"));
}

// ============================================================================
// Database Models FFI
// ============================================================================

const db_models = @import("db/models.zig");
const db_library = @import("db/library.zig");
const db_queue = @import("db/queue.zig");
const db_settings = @import("db/settings.zig");

// Re-export types for Rust bindings
pub const Track = db_models.Track;
pub const Playlist = db_models.Playlist;
pub const PlaylistItem = db_models.PlaylistItem;
pub const QueueItem = db_models.QueueItem;
pub const QueueState = db_models.QueueState;
pub const Setting = db_models.Setting;
pub const Favorite = db_models.Favorite;
pub const LyricsCache = db_models.LyricsCache;
pub const ScrobbleEntry = db_models.ScrobbleEntry;
pub const WatchedFolder = db_models.WatchedFolder;

// Library query types
pub const SearchParams = db_library.SearchParams;
pub const SortField = db_library.SortField;
pub const SortOrder = db_library.SortOrder;
pub const TrackQueryResult = db_library.TrackQueryResult;
pub const SingleTrackResult = db_library.SingleTrackResult;
pub const UpsertResult = db_library.UpsertResult;

// Queue types
pub const QueueItemFull = db_queue.QueueItemFull;
pub const QueueSnapshot = db_queue.QueueSnapshot;
pub const QueueQueryResult = db_queue.QueueQueryResult;
pub const PlaylistInfo = db_queue.PlaylistInfo;
pub const PlaylistQueryResult = db_queue.PlaylistQueryResult;
pub const FavoriteEntry = db_queue.FavoriteEntry;
pub const FavoritesQueryResult = db_queue.FavoritesQueryResult;

// Settings types
pub const SettingEntry = db_settings.SettingEntry;
pub const SettingResult = db_settings.SettingResult;
pub const ScrobbleRecord = db_settings.ScrobbleRecord;
pub const ScrobbleQueryResult = db_settings.ScrobbleQueryResult;
pub const WatchedFolderFFI = db_settings.WatchedFolder;
pub const WatchedFolderResult = db_settings.WatchedFolderResult;

// ============================================================================
// Track FFI Functions
// ============================================================================

/// Create a new empty track
export fn mt_track_new() callconv(.C) Track {
    return Track.init();
}

/// Set track filepath
export fn mt_track_set_filepath(track: *Track, path_ptr: [*:0]const u8) callconv(.C) void {
    const path = std.mem.span(path_ptr);
    track.setFilepath(path);
}

/// Set track title
export fn mt_track_set_title(track: *Track, title_ptr: [*:0]const u8) callconv(.C) void {
    const title = std.mem.span(title_ptr);
    track.setTitle(title);
}

/// Set track artist
export fn mt_track_set_artist(track: *Track, artist_ptr: [*:0]const u8) callconv(.C) void {
    const artist = std.mem.span(artist_ptr);
    track.setArtist(artist);
}

/// Set track album
export fn mt_track_set_album(track: *Track, album_ptr: [*:0]const u8) callconv(.C) void {
    const album = std.mem.span(album_ptr);
    track.setAlbum(album);
}

/// Validate track data
export fn mt_track_validate(track: *const Track) callconv(.C) bool {
    return db_library.validateTrack(track);
}

/// Normalize track strings (trim whitespace)
export fn mt_track_normalize(track: *Track) callconv(.C) void {
    db_library.normalizeTrackStrings(track);
}

// ============================================================================
// Search Parameters FFI Functions
// ============================================================================

/// Create new search parameters with defaults
export fn mt_search_params_new() callconv(.C) SearchParams {
    return SearchParams.init();
}

/// Set search query
export fn mt_search_params_set_query(params: *SearchParams, query_ptr: [*:0]const u8) callconv(.C) void {
    const query = std.mem.span(query_ptr);
    params.setQuery(query);
}

/// Set search limit
export fn mt_search_params_set_limit(params: *SearchParams, limit: u32) callconv(.C) void {
    params.limit = limit;
}

/// Set search offset
export fn mt_search_params_set_offset(params: *SearchParams, offset: u32) callconv(.C) void {
    params.offset = offset;
}

/// Set sort field
export fn mt_search_params_set_sort_by(params: *SearchParams, sort_by: u8) callconv(.C) void {
    params.sort_by = @enumFromInt(sort_by);
}

/// Set sort order
export fn mt_search_params_set_sort_order(params: *SearchParams, sort_order: u8) callconv(.C) void {
    params.sort_order = @enumFromInt(sort_order);
}

// ============================================================================
// Queue Manager FFI Functions
// ============================================================================

/// Calculate move positions for queue item reordering
export fn mt_queue_calculate_move(
    from_pos: u32,
    to_pos: u32,
    total_items: u32,
    out_shift_start: *u32,
    out_shift_end: *u32,
    out_shift_direction: *u8,
) callconv(.C) bool {
    var manager = db_queue.QueueManager.init(gpa.allocator());
    const result = manager.calculateMovePositions(from_pos, to_pos, total_items);

    if (result.error_code != 0) {
        return false;
    }

    out_shift_start.* = result.shift_start;
    out_shift_end.* = result.shift_end;
    out_shift_direction.* = @intFromEnum(result.shift_direction);
    return true;
}

/// Build shuffle order using Fisher-Yates algorithm
/// Returns allocated array that must be freed with mt_free
export fn mt_queue_build_shuffle_order(
    count: u32,
    current_position: u32,
    random_seed: u64,
    out_order: *[*]u32,
    out_len: *u32,
) callconv(.C) bool {
    var manager = db_queue.QueueManager.init(gpa.allocator());
    const order = manager.buildShuffleOrder(count, current_position, random_seed) catch return false;

    out_order.* = order.ptr;
    out_len.* = @intCast(order.len);
    return true;
}

/// Free shuffle order array
export fn mt_queue_free_shuffle_order(order: [*]u32, len: u32) callconv(.C) void {
    gpa.allocator().free(order[0..len]);
}

// ============================================================================
// Playlist FFI Functions
// ============================================================================

/// Create a new empty playlist
export fn mt_playlist_new() callconv(.C) Playlist {
    return Playlist.init();
}

/// Set playlist name
export fn mt_playlist_set_name(playlist: *Playlist, name_ptr: [*:0]const u8) callconv(.C) void {
    const name = std.mem.span(name_ptr);
    playlist.setName(name);
}

/// Create new playlist info
export fn mt_playlist_info_new() callconv(.C) PlaylistInfo {
    return PlaylistInfo.init();
}

/// Set playlist info name
export fn mt_playlist_info_set_name(info: *PlaylistInfo, name_ptr: [*:0]const u8) callconv(.C) void {
    const name = std.mem.span(name_ptr);
    info.setName(name);
}

// ============================================================================
// Settings FFI Functions
// ============================================================================

/// Create new setting entry
export fn mt_setting_new() callconv(.C) SettingEntry {
    return SettingEntry.init();
}

/// Set setting key
export fn mt_setting_set_key(entry: *SettingEntry, key_ptr: [*:0]const u8) callconv(.C) void {
    const key = std.mem.span(key_ptr);
    entry.setKey(key);
}

/// Set setting value
export fn mt_setting_set_value(entry: *SettingEntry, value_ptr: [*:0]const u8) callconv(.C) void {
    const value = std.mem.span(value_ptr);
    entry.setValue(value);
}

/// Parse boolean setting value
export fn mt_setting_parse_bool(value_ptr: [*:0]const u8, out_value: *bool) callconv(.C) bool {
    const value = std.mem.span(value_ptr);
    if (db_settings.SettingsManager.parseBool(value)) |b| {
        out_value.* = b;
        return true;
    }
    return false;
}

/// Parse i32 setting value
export fn mt_setting_parse_i32(value_ptr: [*:0]const u8, out_value: *i32) callconv(.C) bool {
    const value = std.mem.span(value_ptr);
    if (db_settings.SettingsManager.parseInt(i32, value)) |v| {
        out_value.* = v;
        return true;
    }
    return false;
}

/// Parse f32 setting value
export fn mt_setting_parse_f32(value_ptr: [*:0]const u8, out_value: *f32) callconv(.C) bool {
    const value = std.mem.span(value_ptr);
    if (db_settings.SettingsManager.parseFloat(f32, value)) |v| {
        out_value.* = v;
        return true;
    }
    return false;
}

// ============================================================================
// Scrobble FFI Functions
// ============================================================================

/// Create new scrobble record
export fn mt_scrobble_new() callconv(.C) ScrobbleRecord {
    return ScrobbleRecord.init();
}

/// Set scrobble artist
export fn mt_scrobble_set_artist(record: *ScrobbleRecord, artist_ptr: [*:0]const u8) callconv(.C) void {
    const artist = std.mem.span(artist_ptr);
    record.setArtist(artist);
}

/// Set scrobble track
export fn mt_scrobble_set_track(record: *ScrobbleRecord, track_ptr: [*:0]const u8) callconv(.C) void {
    const track = std.mem.span(track_ptr);
    record.setTrack(track);
}

/// Set scrobble album
export fn mt_scrobble_set_album(record: *ScrobbleRecord, album_ptr: [*:0]const u8) callconv(.C) void {
    const album = std.mem.span(album_ptr);
    record.setAlbum(album);
}

/// Check if a play is eligible for scrobbling
export fn mt_scrobble_is_eligible(played_duration: i32, track_duration: i32) callconv(.C) bool {
    return db_settings.ScrobbleManager.isScrobbleEligible(played_duration, track_duration);
}

// ============================================================================
// Watched Folder FFI Functions
// ============================================================================

/// Create new watched folder
export fn mt_watched_folder_new() callconv(.C) WatchedFolderFFI {
    return WatchedFolderFFI.init();
}

/// Set watched folder path
export fn mt_watched_folder_set_path(folder: *WatchedFolderFFI, path_ptr: [*:0]const u8) callconv(.C) void {
    const path = std.mem.span(path_ptr);
    folder.setPath(path);
}

/// Set watched folder scan mode
export fn mt_watched_folder_set_scan_mode(folder: *WatchedFolderFFI, mode: u8) callconv(.C) void {
    folder.setScanMode(@enumFromInt(mode));
}

// ============================================================================
// Queue Item FFI Functions
// ============================================================================

/// Create new queue item
export fn mt_queue_item_new() callconv(.C) QueueItem {
    return QueueItem.init();
}

/// Set queue item filepath
export fn mt_queue_item_set_filepath(item: *QueueItem, path_ptr: [*:0]const u8) callconv(.C) void {
    const path = std.mem.span(path_ptr);
    item.setFilepath(path);
}

/// Create new queue snapshot
export fn mt_queue_snapshot_new() callconv(.C) QueueSnapshot {
    return QueueSnapshot.init();
}

// ============================================================================
// Last.fm FFI Types
// ============================================================================

const lastfm_types = @import("lastfm/types.zig");
const lastfm_client = @import("lastfm/client.zig");

// Re-export Last.fm types for Rust bindings
pub const ScrobbleRequest = lastfm_types.ScrobbleRequest;
pub const NowPlayingRequest = lastfm_types.NowPlayingRequest;
pub const LastfmMethod = lastfm_types.Method;
pub const LastfmErrorCode = lastfm_types.ErrorCode;
pub const BuiltRequest = lastfm_client.BuiltRequest;
pub const ApiResponse = lastfm_client.ApiResponse;
pub const LastfmConfig = lastfm_client.Config;
// Note: RateLimiter contains Mutex and is not FFI-compatible as a value type
// Rate limiting is accessed through the Client pointer
pub const LastfmClient = lastfm_client.Client;

// ============================================================================
// Last.fm Scrobble Request FFI
// ============================================================================

/// Create new scrobble request
export fn mt_lastfm_scrobble_request_new() callconv(.C) ScrobbleRequest {
    return ScrobbleRequest.init();
}

/// Set scrobble request artist
export fn mt_lastfm_scrobble_set_artist(req: *ScrobbleRequest, artist_ptr: [*:0]const u8) callconv(.C) void {
    const artist = std.mem.span(artist_ptr);
    req.setArtist(artist);
}

/// Set scrobble request track
export fn mt_lastfm_scrobble_set_track(req: *ScrobbleRequest, track_ptr: [*:0]const u8) callconv(.C) void {
    const track = std.mem.span(track_ptr);
    req.setTrack(track);
}

/// Set scrobble request album
export fn mt_lastfm_scrobble_set_album(req: *ScrobbleRequest, album_ptr: [*:0]const u8) callconv(.C) void {
    const album = std.mem.span(album_ptr);
    req.setAlbum(album);
}

/// Set scrobble request timestamp
export fn mt_lastfm_scrobble_set_timestamp(req: *ScrobbleRequest, timestamp: i64) callconv(.C) void {
    req.timestamp = timestamp;
}

/// Set scrobble request duration
export fn mt_lastfm_scrobble_set_duration(req: *ScrobbleRequest, duration: i32) callconv(.C) void {
    req.duration = duration;
}

/// Set scrobble request track number
export fn mt_lastfm_scrobble_set_track_number(req: *ScrobbleRequest, track_number: u32) callconv(.C) void {
    req.track_number = track_number;
}

// ============================================================================
// Last.fm Now Playing Request FFI
// ============================================================================

/// Create new now playing request
export fn mt_lastfm_now_playing_request_new() callconv(.C) NowPlayingRequest {
    return NowPlayingRequest.init();
}

/// Set now playing request artist
export fn mt_lastfm_now_playing_set_artist(req: *NowPlayingRequest, artist_ptr: [*:0]const u8) callconv(.C) void {
    const artist = std.mem.span(artist_ptr);
    const len = @min(artist.len, req.artist.len);
    @memcpy(req.artist[0..len], artist[0..len]);
    req.artist_len = @intCast(len);
}

/// Set now playing request track
export fn mt_lastfm_now_playing_set_track(req: *NowPlayingRequest, track_ptr: [*:0]const u8) callconv(.C) void {
    const track = std.mem.span(track_ptr);
    const len = @min(track.len, req.track.len);
    @memcpy(req.track[0..len], track[0..len]);
    req.track_len = @intCast(len);
}

/// Set now playing request album
export fn mt_lastfm_now_playing_set_album(req: *NowPlayingRequest, album_ptr: [*:0]const u8) callconv(.C) void {
    const album = std.mem.span(album_ptr);
    const len = @min(album.len, req.album.len);
    @memcpy(req.album[0..len], album[0..len]);
    req.album_len = @intCast(len);
}

/// Set now playing request duration
export fn mt_lastfm_now_playing_set_duration(req: *NowPlayingRequest, duration: i32) callconv(.C) void {
    req.duration = duration;
}

/// Set now playing request track number
export fn mt_lastfm_now_playing_set_track_number(req: *NowPlayingRequest, track_number: u32) callconv(.C) void {
    req.track_number = track_number;
}

// ============================================================================
// Last.fm Client FFI
// ============================================================================

/// Create new Last.fm client
/// Returns null on allocation failure
export fn mt_lastfm_client_new(
    api_key_ptr: [*:0]const u8,
    api_secret_ptr: [*:0]const u8,
) callconv(.C) ?*LastfmClient {
    const api_key = std.mem.span(api_key_ptr);
    const api_secret = std.mem.span(api_secret_ptr);
    return LastfmClient.init(gpa.allocator(), api_key, api_secret) catch null;
}

/// Free Last.fm client
export fn mt_lastfm_client_free(client: ?*LastfmClient) callconv(.C) void {
    if (client) |c| {
        c.deinit();
    }
}

/// Set client session key for authenticated requests
export fn mt_lastfm_client_set_session_key(
    client: *LastfmClient,
    session_key_ptr: [*:0]const u8,
) callconv(.C) void {
    const session_key = std.mem.span(session_key_ptr);
    client.setSessionKey(session_key);
}

/// Clear client session key (logout)
export fn mt_lastfm_client_clear_session_key(client: *LastfmClient) callconv(.C) void {
    client.clearSessionKey();
}

/// Check if client has a valid session key
export fn mt_lastfm_client_is_authenticated(client: *const LastfmClient) callconv(.C) bool {
    return client.isAuthenticated();
}

/// Build a scrobble request
/// Returns true on success, populates out_request
export fn mt_lastfm_client_build_scrobble(
    client: *LastfmClient,
    scrobble: *const ScrobbleRequest,
    out_request: *BuiltRequest,
) callconv(.C) bool {
    const result = client.buildScrobbleRequest(scrobble) catch return false;
    out_request.* = result;
    return true;
}

/// Build a now playing request
/// Returns true on success, populates out_request
export fn mt_lastfm_client_build_now_playing(
    client: *LastfmClient,
    now_playing: *const NowPlayingRequest,
    out_request: *BuiltRequest,
) callconv(.C) bool {
    const result = client.buildNowPlayingRequest(now_playing) catch return false;
    out_request.* = result;
    return true;
}

/// Wait for rate limit slot (blocking)
export fn mt_lastfm_client_wait_for_rate_limit(client: *LastfmClient) callconv(.C) void {
    client.waitForRateLimit();
}

// ============================================================================
// Last.fm Rate Limiter FFI (via client pointer)
// ============================================================================

// Note: RateLimiter contains Mutex which is not FFI-compatible as a return value.
// Rate limiting is accessed through the client's rate limiter via pointer.

/// Get wait time in nanoseconds from client's rate limiter (0 if no wait needed)
export fn mt_lastfm_client_get_wait_time_ns(client: *LastfmClient) callconv(.C) u64 {
    return client.getRateLimiter().getWaitTime();
}

/// Record that a request was made (for external HTTP callers)
export fn mt_lastfm_client_record_request(client: *LastfmClient) callconv(.C) void {
    client.getRateLimiter().recordRequest();
}

// ============================================================================
// Last.fm Signature FFI
// ============================================================================

/// Generate API signature for key-value pairs
/// pairs_ptr is an array of [key_ptr, value_ptr] pairs (2 * count elements)
/// Returns true on success, writes 32-char hex signature to out_sig
export fn mt_lastfm_generate_signature(
    pairs_ptr: [*]const [*:0]const u8,
    count: u32,
    api_secret_ptr: [*:0]const u8,
    out_sig: [*]u8,
) callconv(.C) bool {
    const allocator = gpa.allocator();
    const api_secret = std.mem.span(api_secret_ptr);

    // Build params from pairs
    var params = lastfm_types.Params.init(allocator);
    defer params.deinit();

    var i: u32 = 0;
    while (i < count) : (i += 1) {
        const key = std.mem.span(pairs_ptr[i * 2]);
        const value = std.mem.span(pairs_ptr[i * 2 + 1]);
        params.put(key, value) catch return false;
    }

    // Generate signature
    const sig = lastfm_types.generateSignature(allocator, &params, api_secret) catch return false;
    defer allocator.free(sig);

    // Copy to output buffer (32 hex chars)
    @memcpy(out_sig[0..32], sig[0..32]);
    return true;
}

// ============================================================================
// Last.fm Response FFI
// ============================================================================

/// Create success response
export fn mt_lastfm_response_success() callconv(.C) ApiResponse {
    return ApiResponse.initSuccess();
}

/// Create error response
export fn mt_lastfm_response_error(error_code: u32, message_ptr: [*:0]const u8) callconv(.C) ApiResponse {
    const message = std.mem.span(message_ptr);
    return ApiResponse.initError(error_code, message);
}

/// Create new built request
export fn mt_lastfm_built_request_new() callconv(.C) BuiltRequest {
    return BuiltRequest.init();
}

/// Get API base URL
export fn mt_lastfm_get_api_url() callconv(.C) [*:0]const u8 {
    return lastfm_client.API_BASE_URL;
}

// ============================================================================
// Database FFI Tests
// ============================================================================

test "FFI track creation" {
    var track = mt_track_new();
    try std.testing.expectEqual(@as(i64, 0), track.id);

    mt_track_set_filepath(&track, "/music/test.mp3");
    try std.testing.expectEqualStrings("/music/test.mp3", track.getFilepath());

    mt_track_set_title(&track, "Test Song");
    try std.testing.expectEqualStrings("Test Song", track.getTitle());

    try std.testing.expect(mt_track_validate(&track));
}

test "FFI search params" {
    var params = mt_search_params_new();
    try std.testing.expectEqual(@as(u32, 100), params.limit);

    mt_search_params_set_query(&params, "beatles");
    try std.testing.expectEqualStrings("beatles", params.getQuery());

    mt_search_params_set_limit(&params, 50);
    try std.testing.expectEqual(@as(u32, 50), params.limit);
}

test "FFI queue move calculation" {
    var shift_start: u32 = 0;
    var shift_end: u32 = 0;
    var shift_direction: u8 = 0;

    const success = mt_queue_calculate_move(2, 5, 10, &shift_start, &shift_end, &shift_direction);
    try std.testing.expect(success);
    try std.testing.expectEqual(@as(u32, 2), shift_start);
    try std.testing.expectEqual(@as(u32, 5), shift_end);
}

test "FFI setting parsing" {
    var bool_val: bool = false;
    try std.testing.expect(mt_setting_parse_bool("true", &bool_val));
    try std.testing.expect(bool_val);

    var int_val: i32 = 0;
    try std.testing.expect(mt_setting_parse_i32("42", &int_val));
    try std.testing.expectEqual(@as(i32, 42), int_val);

    var float_val: f32 = 0;
    try std.testing.expect(mt_setting_parse_f32("3.14", &float_val));
    try std.testing.expectApproxEqAbs(@as(f32, 3.14), float_val, 0.001);
}

test "FFI scrobble eligibility" {
    // 4 minutes played on 10 minute track - eligible
    try std.testing.expect(mt_scrobble_is_eligible(240, 600));

    // 2 minutes played on 3 minute track - eligible (>50%)
    try std.testing.expect(mt_scrobble_is_eligible(120, 180));

    // 1 minute played on 10 minute track - not eligible
    try std.testing.expect(!mt_scrobble_is_eligible(60, 600));
}

test "FFI playlist creation" {
    var playlist = mt_playlist_new();
    try std.testing.expectEqual(@as(i64, 0), playlist.id);

    mt_playlist_set_name(&playlist, "My Playlist");
    try std.testing.expectEqualStrings("My Playlist", playlist.getName());
}

test "FFI watched folder" {
    var folder = mt_watched_folder_new();
    try std.testing.expect(folder.enabled);

    mt_watched_folder_set_path(&folder, "/home/user/music");
    try std.testing.expectEqualStrings("/home/user/music", folder.getPath());

    mt_watched_folder_set_scan_mode(&folder, 2); // watch mode
    try std.testing.expectEqual(db_settings.ScanMode.watch, folder.getScanMode());
}

// ============================================================================
// Last.fm FFI Tests
// ============================================================================

test "FFI lastfm scrobble request" {
    var req = mt_lastfm_scrobble_request_new();
    try std.testing.expectEqual(@as(u32, 0), req.artist_len);
    try std.testing.expectEqual(@as(u32, 0), req.track_len);

    mt_lastfm_scrobble_set_artist(&req, "The Beatles");
    try std.testing.expectEqualStrings("The Beatles", req.getArtist());

    mt_lastfm_scrobble_set_track(&req, "Hey Jude");
    try std.testing.expectEqualStrings("Hey Jude", req.getTrack());

    mt_lastfm_scrobble_set_album(&req, "White Album");
    try std.testing.expectEqualStrings("White Album", req.getAlbum());

    mt_lastfm_scrobble_set_timestamp(&req, 1234567890);
    try std.testing.expectEqual(@as(i64, 1234567890), req.timestamp);

    mt_lastfm_scrobble_set_duration(&req, 240);
    try std.testing.expectEqual(@as(i32, 240), req.duration);

    mt_lastfm_scrobble_set_track_number(&req, 5);
    try std.testing.expectEqual(@as(u32, 5), req.track_number);
}

test "FFI lastfm now playing request" {
    var req = mt_lastfm_now_playing_request_new();
    try std.testing.expectEqual(@as(u32, 0), req.artist_len);

    mt_lastfm_now_playing_set_artist(&req, "Pink Floyd");
    try std.testing.expectEqualStrings("Pink Floyd", req.getArtist());

    mt_lastfm_now_playing_set_track(&req, "Comfortably Numb");
    try std.testing.expectEqualStrings("Comfortably Numb", req.getTrack());

    mt_lastfm_now_playing_set_album(&req, "The Wall");
    try std.testing.expectEqualStrings("The Wall", req.getAlbum());

    mt_lastfm_now_playing_set_duration(&req, 382);
    try std.testing.expectEqual(@as(i32, 382), req.duration);
}

test "FFI lastfm client lifecycle" {
    const client = mt_lastfm_client_new("test_api_key", "test_api_secret");
    try std.testing.expect(client != null);

    // Initially not authenticated
    try std.testing.expect(!mt_lastfm_client_is_authenticated(client.?));

    // Set session key
    mt_lastfm_client_set_session_key(client.?, "test_session_key");
    try std.testing.expect(mt_lastfm_client_is_authenticated(client.?));

    // Clear session key
    mt_lastfm_client_clear_session_key(client.?);
    try std.testing.expect(!mt_lastfm_client_is_authenticated(client.?));

    mt_lastfm_client_free(client);
}

test "FFI lastfm client build scrobble" {
    const client = mt_lastfm_client_new("test_api_key", "test_api_secret");
    try std.testing.expect(client != null);
    defer mt_lastfm_client_free(client);

    mt_lastfm_client_set_session_key(client.?, "test_session");

    var scrobble = mt_lastfm_scrobble_request_new();
    mt_lastfm_scrobble_set_artist(&scrobble, "Test Artist");
    mt_lastfm_scrobble_set_track(&scrobble, "Test Track");
    mt_lastfm_scrobble_set_timestamp(&scrobble, 1234567890);

    var built_request = mt_lastfm_built_request_new();
    const success = mt_lastfm_client_build_scrobble(client.?, &scrobble, &built_request);
    try std.testing.expect(success);
    try std.testing.expect(built_request.body_len > 0);
    try std.testing.expectEqualStrings("track.scrobble", built_request.getApiMethod());
}

test "FFI lastfm rate limiter via client" {
    const client = mt_lastfm_client_new("test_api_key", "test_api_secret");
    try std.testing.expect(client != null);
    defer mt_lastfm_client_free(client);

    // First request should have no wait (or very small if timing is off)
    const wait_time = mt_lastfm_client_get_wait_time_ns(client.?);
    try std.testing.expect(wait_time == 0 or wait_time < 1_000_000); // less than 1ms
}

test "FFI lastfm response" {
    const success_resp = mt_lastfm_response_success();
    try std.testing.expect(success_resp.success);
    try std.testing.expectEqual(@as(u32, 0), success_resp.error_code);

    const error_resp = mt_lastfm_response_error(4, "Authentication Failed");
    try std.testing.expect(!error_resp.success);
    try std.testing.expectEqual(@as(u32, 4), error_resp.error_code);
    try std.testing.expectEqualStrings("Authentication Failed", error_resp.getErrorMessage());
}

test "FFI lastfm built request" {
    const req = mt_lastfm_built_request_new();
    try std.testing.expectEqual(@as(u32, 0), req.body_len);
    try std.testing.expectEqualStrings("POST", req.getMethod());
}
