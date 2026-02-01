//! Library database queries.
//!
//! Provides high-level query interface for library operations.
//! Actual SQLite operations are handled by Rust via FFI - this module
//! provides types and interfaces for cross-language communication.

const std = @import("std");
const models = @import("models.zig");
const Allocator = std.mem.Allocator;

// =============================================================================
// Error Types
// =============================================================================

pub const DbError = error{
    ConnectionFailed,
    QueryFailed,
    NotFound,
    InvalidData,
    OutOfMemory,
    Timeout,
    Busy,
    Constraint,
};

// =============================================================================
// Query Parameters (FFI-safe)
// =============================================================================

/// Search query parameters
pub const SearchParams = extern struct {
    query: [512]u8,
    query_len: u32,
    limit: u32,
    offset: u32,
    sort_by: SortField,
    sort_order: SortOrder,

    pub fn init() SearchParams {
        var params = SearchParams{
            .query = undefined,
            .query_len = 0,
            .limit = 100,
            .offset = 0,
            .sort_by = .title,
            .sort_order = .ascending,
        };
        @memset(&params.query, 0);
        return params;
    }

    pub fn setQuery(self: *SearchParams, q: []const u8) void {
        const len = @min(q.len, self.query.len);
        @memcpy(self.query[0..len], q[0..len]);
        self.query_len = @intCast(len);
    }

    pub fn getQuery(self: *const SearchParams) []const u8 {
        return self.query[0..self.query_len];
    }
};

pub const SortField = enum(u8) {
    title = 0,
    artist = 1,
    album = 2,
    duration = 3,
    date_added = 4,
    play_count = 5,
    last_played = 6,
};

pub const SortOrder = enum(u8) {
    ascending = 0,
    descending = 1,
};

// =============================================================================
// Query Results (FFI-safe)
// =============================================================================

/// Result of a track query - contains count and pointer to track array
/// Memory is managed by the caller (allocator provided to query functions)
pub const TrackQueryResult = extern struct {
    /// Pointer to array of tracks (null if error or empty)
    tracks_ptr: ?[*]models.Track,
    /// Number of tracks in the array
    count: u32,
    /// Total count (for pagination - may be larger than count)
    total_count: u32,
    /// Error code (0 = success)
    error_code: u32,

    pub fn initSuccess(tracks: []models.Track, total: u32) TrackQueryResult {
        return TrackQueryResult{
            .tracks_ptr = if (tracks.len > 0) tracks.ptr else null,
            .count = @intCast(tracks.len),
            .total_count = total,
            .error_code = 0,
        };
    }

    pub fn initEmpty() TrackQueryResult {
        return TrackQueryResult{
            .tracks_ptr = null,
            .count = 0,
            .total_count = 0,
            .error_code = 0,
        };
    }

    pub fn initError(code: u32) TrackQueryResult {
        return TrackQueryResult{
            .tracks_ptr = null,
            .count = 0,
            .total_count = 0,
            .error_code = code,
        };
    }

    pub fn isSuccess(self: *const TrackQueryResult) bool {
        return self.error_code == 0;
    }

    pub fn getTracks(self: *const TrackQueryResult) []models.Track {
        if (self.tracks_ptr) |ptr| {
            return ptr[0..self.count];
        }
        return &[_]models.Track{};
    }
};

/// Single track result (for getById operations)
pub const SingleTrackResult = extern struct {
    track: models.Track,
    found: bool,
    error_code: u32,

    pub fn initFound(track: models.Track) SingleTrackResult {
        return SingleTrackResult{
            .track = track,
            .found = true,
            .error_code = 0,
        };
    }

    pub fn initNotFound() SingleTrackResult {
        return SingleTrackResult{
            .track = models.Track.init(),
            .found = false,
            .error_code = 0,
        };
    }

    pub fn initError(code: u32) SingleTrackResult {
        return SingleTrackResult{
            .track = models.Track.init(),
            .found = false,
            .error_code = code,
        };
    }
};

/// Result of an upsert operation
pub const UpsertResult = extern struct {
    id: i64,
    was_insert: bool, // true if new record, false if update
    error_code: u32,

    pub fn initSuccess(id: i64, was_insert: bool) UpsertResult {
        return UpsertResult{
            .id = id,
            .was_insert = was_insert,
            .error_code = 0,
        };
    }

    pub fn initError(code: u32) UpsertResult {
        return UpsertResult{
            .id = 0,
            .was_insert = false,
            .error_code = code,
        };
    }
};

// =============================================================================
// Library Manager
// =============================================================================

/// Library manager - provides query building and result handling
/// Actual database operations are delegated to FFI callbacks
pub const LibraryManager = struct {
    allocator: Allocator,

    /// FFI callback for executing queries (set by Rust side)
    query_callback: ?*const fn (query_type: QueryType, params: *const anyopaque) callconv(.C) TrackQueryResult,

    pub const QueryType = enum(u8) {
        get_all = 0,
        get_by_id = 1,
        search = 2,
        get_by_filepath = 3,
        get_recent = 4,
        get_most_played = 5,
    };

    pub fn init(allocator: Allocator) LibraryManager {
        return LibraryManager{
            .allocator = allocator,
            .query_callback = null,
        };
    }

    /// Build search filter string for debugging/logging
    pub fn buildSearchFilter(
        self: *LibraryManager,
        params: *const SearchParams,
    ) ![]u8 {
        const query = params.getQuery();
        if (query.len == 0) {
            return try self.allocator.dupe(u8, "SELECT * FROM library");
        }

        // Build SQL-like filter string (for logging, not actual execution)
        var buf = std.ArrayList(u8).init(self.allocator);
        errdefer buf.deinit();

        try buf.appendSlice("SELECT * FROM library WHERE ");
        try buf.appendSlice("title LIKE '%");
        try buf.appendSlice(query);
        try buf.appendSlice("%' OR artist LIKE '%");
        try buf.appendSlice(query);
        try buf.appendSlice("%' OR album LIKE '%");
        try buf.appendSlice(query);
        try buf.appendSlice("%'");

        // Add ORDER BY
        try buf.appendSlice(" ORDER BY ");
        try buf.appendSlice(switch (params.sort_by) {
            .title => "title",
            .artist => "artist",
            .album => "album",
            .duration => "duration",
            .date_added => "date_added",
            .play_count => "play_count",
            .last_played => "last_played_at",
        });
        try buf.appendSlice(switch (params.sort_order) {
            .ascending => " ASC",
            .descending => " DESC",
        });

        // Add LIMIT/OFFSET
        var limit_buf: [64]u8 = undefined;
        const limit_str = try std.fmt.bufPrint(&limit_buf, " LIMIT {d} OFFSET {d}", .{ params.limit, params.offset });
        try buf.appendSlice(limit_str);

        return try buf.toOwnedSlice();
    }
};

// =============================================================================
// Track Validation
// =============================================================================

/// Validate track data before insertion
pub fn validateTrack(track: *const models.Track) bool {
    // Must have filepath
    if (track.filepath_len == 0) return false;

    // Must have title (or use filename as fallback)
    if (track.title_len == 0) return false;

    // Duration should be positive or zero
    if (track.duration_secs < 0) return false;

    return true;
}

/// Normalize track data (trim whitespace, etc.)
/// Uses temporary buffers to avoid aliasing issues with memcpy
pub fn normalizeTrackStrings(track: *models.Track) void {
    // Trim filepath - use temp buffer to avoid aliasing
    const filepath = track.getFilepath();
    const trimmed_path = std.mem.trim(u8, filepath, " \t\n\r");
    if (trimmed_path.len != filepath.len) {
        // Copy to stack buffer then back to avoid aliasing
        var path_buf: [4096]u8 = undefined;
        @memcpy(path_buf[0..trimmed_path.len], trimmed_path);
        @memcpy(track.filepath[0..trimmed_path.len], path_buf[0..trimmed_path.len]);
        track.filepath_len = @intCast(trimmed_path.len);
    }

    // Trim title
    const title = track.getTitle();
    const trimmed_title = std.mem.trim(u8, title, " \t\n\r");
    if (trimmed_title.len != title.len) {
        var title_buf: [512]u8 = undefined;
        @memcpy(title_buf[0..trimmed_title.len], trimmed_title);
        @memcpy(track.title[0..trimmed_title.len], title_buf[0..trimmed_title.len]);
        track.title_len = @intCast(trimmed_title.len);
    }

    // Trim artist
    const artist = track.getArtist();
    const trimmed_artist = std.mem.trim(u8, artist, " \t\n\r");
    if (trimmed_artist.len != artist.len) {
        var artist_buf: [512]u8 = undefined;
        @memcpy(artist_buf[0..trimmed_artist.len], trimmed_artist);
        @memcpy(track.artist[0..trimmed_artist.len], artist_buf[0..trimmed_artist.len]);
        track.artist_len = @intCast(trimmed_artist.len);
    }

    // Trim album
    const album = track.getAlbum();
    const trimmed_album = std.mem.trim(u8, album, " \t\n\r");
    if (trimmed_album.len != album.len) {
        var album_buf: [512]u8 = undefined;
        @memcpy(album_buf[0..trimmed_album.len], trimmed_album);
        @memcpy(track.album[0..trimmed_album.len], album_buf[0..trimmed_album.len]);
        track.album_len = @intCast(trimmed_album.len);
    }
}

// =============================================================================
// Tests
// =============================================================================

test "SearchParams initialization" {
    const params = SearchParams.init();
    try std.testing.expectEqual(@as(u32, 0), params.query_len);
    try std.testing.expectEqual(@as(u32, 100), params.limit);
    try std.testing.expectEqual(SortField.title, params.sort_by);
}

test "SearchParams setQuery" {
    var params = SearchParams.init();
    params.setQuery("test query");
    try std.testing.expectEqualStrings("test query", params.getQuery());
}

test "TrackQueryResult success" {
    var tracks: [2]models.Track = undefined;
    tracks[0] = models.Track.init();
    tracks[1] = models.Track.init();

    const result = TrackQueryResult.initSuccess(&tracks, 100);
    try std.testing.expect(result.isSuccess());
    try std.testing.expectEqual(@as(u32, 2), result.count);
    try std.testing.expectEqual(@as(u32, 100), result.total_count);
}

test "TrackQueryResult empty" {
    const result = TrackQueryResult.initEmpty();
    try std.testing.expect(result.isSuccess());
    try std.testing.expectEqual(@as(u32, 0), result.count);
    try std.testing.expectEqual(@as(usize, 0), result.getTracks().len);
}

test "TrackQueryResult error" {
    const result = TrackQueryResult.initError(1);
    try std.testing.expect(!result.isSuccess());
    try std.testing.expectEqual(@as(u32, 1), result.error_code);
}

test "SingleTrackResult found" {
    var track = models.Track.init();
    track.id = 42;

    const result = SingleTrackResult.initFound(track);
    try std.testing.expect(result.found);
    try std.testing.expectEqual(@as(i64, 42), result.track.id);
}

test "SingleTrackResult not found" {
    const result = SingleTrackResult.initNotFound();
    try std.testing.expect(!result.found);
    try std.testing.expectEqual(@as(u32, 0), result.error_code);
}

test "UpsertResult insert" {
    const result = UpsertResult.initSuccess(123, true);
    try std.testing.expectEqual(@as(i64, 123), result.id);
    try std.testing.expect(result.was_insert);
}

test "UpsertResult update" {
    const result = UpsertResult.initSuccess(456, false);
    try std.testing.expectEqual(@as(i64, 456), result.id);
    try std.testing.expect(!result.was_insert);
}

test "validateTrack valid" {
    var track = models.Track.init();
    track.setFilepath("/music/test.mp3");
    track.setTitle("Test Track");
    track.duration_secs = 180.0;

    try std.testing.expect(validateTrack(&track));
}

test "validateTrack no filepath" {
    var track = models.Track.init();
    track.setTitle("Test Track");

    try std.testing.expect(!validateTrack(&track));
}

test "validateTrack no title" {
    var track = models.Track.init();
    track.setFilepath("/music/test.mp3");

    try std.testing.expect(!validateTrack(&track));
}

test "normalizeTrackStrings" {
    var track = models.Track.init();
    track.setFilepath("  /music/test.mp3  ");
    track.setTitle("  Test Track  ");
    track.setArtist("\tArtist Name\n");
    track.setAlbum(" Album Name ");

    normalizeTrackStrings(&track);

    try std.testing.expectEqualStrings("/music/test.mp3", track.getFilepath());
    try std.testing.expectEqualStrings("Test Track", track.getTitle());
    try std.testing.expectEqualStrings("Artist Name", track.getArtist());
    try std.testing.expectEqualStrings("Album Name", track.getAlbum());
}

test "LibraryManager buildSearchFilter" {
    const allocator = std.testing.allocator;
    var manager = LibraryManager.init(allocator);

    var params = SearchParams.init();
    params.setQuery("beatles");
    params.limit = 50;
    params.offset = 10;
    params.sort_by = .artist;
    params.sort_order = .descending;

    const filter = try manager.buildSearchFilter(&params);
    defer allocator.free(filter);

    try std.testing.expect(std.mem.indexOf(u8, filter, "beatles") != null);
    try std.testing.expect(std.mem.indexOf(u8, filter, "ORDER BY artist DESC") != null);
    try std.testing.expect(std.mem.indexOf(u8, filter, "LIMIT 50 OFFSET 10") != null);
}
