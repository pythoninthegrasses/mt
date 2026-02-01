//! Settings, scrobble tracking, and watched folders database operations.
//!
//! Actual SQLite operations are handled by Rust via FFI - this module
//! provides types and interfaces for cross-language communication.

const std = @import("std");
const models = @import("models.zig");
const Allocator = std.mem.Allocator;

// =============================================================================
// Settings Types (FFI-safe)
// =============================================================================

/// Setting key-value pair
pub const SettingEntry = extern struct {
    key: [128]u8,
    key_len: u32,
    value: [4096]u8,
    value_len: u32,

    pub fn init() SettingEntry {
        var entry = SettingEntry{
            .key = undefined,
            .key_len = 0,
            .value = undefined,
            .value_len = 0,
        };
        @memset(&entry.key, 0);
        @memset(&entry.value, 0);
        return entry;
    }

    pub fn getKey(self: *const SettingEntry) []const u8 {
        return self.key[0..self.key_len];
    }

    pub fn getValue(self: *const SettingEntry) []const u8 {
        return self.value[0..self.value_len];
    }

    pub fn setKey(self: *SettingEntry, k: []const u8) void {
        const len = @min(k.len, self.key.len);
        @memcpy(self.key[0..len], k[0..len]);
        self.key_len = @intCast(len);
    }

    pub fn setValue(self: *SettingEntry, v: []const u8) void {
        const len = @min(v.len, self.value.len);
        @memcpy(self.value[0..len], v[0..len]);
        self.value_len = @intCast(len);
    }
};

/// Setting query result
pub const SettingResult = extern struct {
    entry: SettingEntry,
    found: bool,
    error_code: u32,

    pub fn initFound(key: []const u8, value: []const u8) SettingResult {
        var entry = SettingEntry.init();
        entry.setKey(key);
        entry.setValue(value);
        return SettingResult{
            .entry = entry,
            .found = true,
            .error_code = 0,
        };
    }

    pub fn initNotFound() SettingResult {
        return SettingResult{
            .entry = SettingEntry.init(),
            .found = false,
            .error_code = 0,
        };
    }

    pub fn initError(code: u32) SettingResult {
        return SettingResult{
            .entry = SettingEntry.init(),
            .found = false,
            .error_code = code,
        };
    }

    pub fn isSuccess(self: *const SettingResult) bool {
        return self.error_code == 0;
    }
};

// =============================================================================
// Common Setting Keys
// =============================================================================

pub const SettingKeys = struct {
    pub const volume: []const u8 = "volume";
    pub const shuffle: []const u8 = "shuffle";
    pub const repeat_mode: []const u8 = "repeat_mode";
    pub const lastfm_session: []const u8 = "lastfm_session";
    pub const lastfm_username: []const u8 = "lastfm_username";
    pub const theme: []const u8 = "theme";
    pub const window_width: []const u8 = "window_width";
    pub const window_height: []const u8 = "window_height";
    pub const window_x: []const u8 = "window_x";
    pub const window_y: []const u8 = "window_y";
    pub const sidebar_width: []const u8 = "sidebar_width";
    pub const show_artwork: []const u8 = "show_artwork";
    pub const crossfade_duration: []const u8 = "crossfade_duration";
    pub const equalizer_preset: []const u8 = "equalizer_preset";
};

// =============================================================================
// Scrobble Types (FFI-safe)
// =============================================================================

/// Scrobble record for tracking plays
pub const ScrobbleRecord = extern struct {
    id: i64,
    track_id: i64,
    artist: [512]u8,
    artist_len: u32,
    track: [512]u8,
    track_len: u32,
    album: [512]u8,
    album_len: u32,
    timestamp: i64, // Unix timestamp of play
    duration: i32, // Track duration in seconds
    submitted: bool, // Whether scrobble was submitted to Last.fm

    pub fn init() ScrobbleRecord {
        var record = ScrobbleRecord{
            .id = 0,
            .track_id = 0,
            .artist = undefined,
            .artist_len = 0,
            .track = undefined,
            .track_len = 0,
            .album = undefined,
            .album_len = 0,
            .timestamp = 0,
            .duration = 0,
            .submitted = false,
        };
        @memset(&record.artist, 0);
        @memset(&record.track, 0);
        @memset(&record.album, 0);
        return record;
    }

    pub fn getArtist(self: *const ScrobbleRecord) []const u8 {
        return self.artist[0..self.artist_len];
    }

    pub fn getTrack(self: *const ScrobbleRecord) []const u8 {
        return self.track[0..self.track_len];
    }

    pub fn getAlbum(self: *const ScrobbleRecord) []const u8 {
        return self.album[0..self.album_len];
    }

    pub fn setArtist(self: *ScrobbleRecord, a: []const u8) void {
        const len = @min(a.len, self.artist.len);
        @memcpy(self.artist[0..len], a[0..len]);
        self.artist_len = @intCast(len);
    }

    pub fn setTrack(self: *ScrobbleRecord, t: []const u8) void {
        const len = @min(t.len, self.track.len);
        @memcpy(self.track[0..len], t[0..len]);
        self.track_len = @intCast(len);
    }

    pub fn setAlbum(self: *ScrobbleRecord, a: []const u8) void {
        const len = @min(a.len, self.album.len);
        @memcpy(self.album[0..len], a[0..len]);
        self.album_len = @intCast(len);
    }
};

/// Scrobble query result
pub const ScrobbleQueryResult = extern struct {
    scrobbles_ptr: ?[*]ScrobbleRecord,
    count: u32,
    error_code: u32,

    pub fn initSuccess(scrobbles: []ScrobbleRecord) ScrobbleQueryResult {
        return ScrobbleQueryResult{
            .scrobbles_ptr = if (scrobbles.len > 0) scrobbles.ptr else null,
            .count = @intCast(scrobbles.len),
            .error_code = 0,
        };
    }

    pub fn initEmpty() ScrobbleQueryResult {
        return ScrobbleQueryResult{
            .scrobbles_ptr = null,
            .count = 0,
            .error_code = 0,
        };
    }

    pub fn initError(code: u32) ScrobbleQueryResult {
        return ScrobbleQueryResult{
            .scrobbles_ptr = null,
            .count = 0,
            .error_code = code,
        };
    }

    pub fn isSuccess(self: *const ScrobbleQueryResult) bool {
        return self.error_code == 0;
    }

    pub fn getScrobbles(self: *const ScrobbleQueryResult) []ScrobbleRecord {
        if (self.scrobbles_ptr) |ptr| {
            return ptr[0..self.count];
        }
        return &[_]ScrobbleRecord{};
    }
};

// =============================================================================
// Watched Folder Types (FFI-safe)
// =============================================================================

/// Scan mode for watched folders
pub const ScanMode = enum(u8) {
    manual = 0, // Only scan when explicitly triggered
    auto = 1, // Scan on application start
    watch = 2, // Monitor for filesystem changes
};

/// Watched folder entry
pub const WatchedFolder = extern struct {
    id: i64,
    path: [4096]u8,
    path_len: u32,
    scan_mode: u8,
    enabled: bool,
    last_scan: i64, // Unix timestamp of last scan
    track_count: u32, // Number of tracks found

    pub fn init() WatchedFolder {
        var folder = WatchedFolder{
            .id = 0,
            .path = undefined,
            .path_len = 0,
            .scan_mode = @intFromEnum(ScanMode.manual),
            .enabled = true,
            .last_scan = 0,
            .track_count = 0,
        };
        @memset(&folder.path, 0);
        return folder;
    }

    pub fn getPath(self: *const WatchedFolder) []const u8 {
        return self.path[0..self.path_len];
    }

    pub fn setPath(self: *WatchedFolder, p: []const u8) void {
        const len = @min(p.len, self.path.len);
        @memcpy(self.path[0..len], p[0..len]);
        self.path_len = @intCast(len);
    }

    pub fn getScanMode(self: *const WatchedFolder) ScanMode {
        return @enumFromInt(self.scan_mode);
    }

    pub fn setScanMode(self: *WatchedFolder, mode: ScanMode) void {
        self.scan_mode = @intFromEnum(mode);
    }
};

/// Watched folder query result
pub const WatchedFolderResult = extern struct {
    folders_ptr: ?[*]WatchedFolder,
    count: u32,
    error_code: u32,

    pub fn initSuccess(folders: []WatchedFolder) WatchedFolderResult {
        return WatchedFolderResult{
            .folders_ptr = if (folders.len > 0) folders.ptr else null,
            .count = @intCast(folders.len),
            .error_code = 0,
        };
    }

    pub fn initEmpty() WatchedFolderResult {
        return WatchedFolderResult{
            .folders_ptr = null,
            .count = 0,
            .error_code = 0,
        };
    }

    pub fn initError(code: u32) WatchedFolderResult {
        return WatchedFolderResult{
            .folders_ptr = null,
            .count = 0,
            .error_code = code,
        };
    }

    pub fn isSuccess(self: *const WatchedFolderResult) bool {
        return self.error_code == 0;
    }

    pub fn getFolders(self: *const WatchedFolderResult) []WatchedFolder {
        if (self.folders_ptr) |ptr| {
            return ptr[0..self.count];
        }
        return &[_]WatchedFolder{};
    }
};

// =============================================================================
// Settings Manager
// =============================================================================

/// Settings manager - provides setting value parsing and validation
pub const SettingsManager = struct {
    allocator: Allocator,

    pub fn init(allocator: Allocator) SettingsManager {
        return SettingsManager{
            .allocator = allocator,
        };
    }

    /// Parse boolean setting value
    pub fn parseBool(value: []const u8) ?bool {
        if (std.mem.eql(u8, value, "true") or std.mem.eql(u8, value, "1")) {
            return true;
        }
        if (std.mem.eql(u8, value, "false") or std.mem.eql(u8, value, "0")) {
            return false;
        }
        return null;
    }

    /// Parse integer setting value
    pub fn parseInt(comptime T: type, value: []const u8) ?T {
        return std.fmt.parseInt(T, value, 10) catch null;
    }

    /// Parse float setting value
    pub fn parseFloat(comptime T: type, value: []const u8) ?T {
        return std.fmt.parseFloat(T, value) catch null;
    }

    /// Format boolean as setting value
    pub fn formatBool(value: bool) []const u8 {
        return if (value) "true" else "false";
    }

    /// Format integer as setting value
    pub fn formatInt(self: *SettingsManager, value: anytype) ![]u8 {
        var buf: [32]u8 = undefined;
        const result = std.fmt.bufPrint(&buf, "{d}", .{value}) catch return error.FormatError;
        return try self.allocator.dupe(u8, result);
    }
};

// =============================================================================
// Scrobble Manager
// =============================================================================

/// Scrobble manager - validates scrobble eligibility
pub const ScrobbleManager = struct {
    /// Minimum play duration for scrobble (4 minutes per Last.fm rules)
    pub const MIN_SCROBBLE_DURATION: i32 = 240;
    /// Minimum play percentage for scrobble (50% per Last.fm rules)
    pub const MIN_SCROBBLE_PERCENTAGE: f32 = 0.5;
    /// Maximum pending scrobbles to batch submit
    pub const MAX_BATCH_SIZE: u32 = 50;

    /// Check if a play is eligible for scrobbling
    pub fn isScrobbleEligible(played_duration: i32, track_duration: i32) bool {
        // Track must have been played for at least 4 minutes
        // OR at least 50% of the track, whichever comes first
        if (track_duration <= 0) return false;
        if (played_duration <= 0) return false;

        // Check 4-minute rule
        if (played_duration >= MIN_SCROBBLE_DURATION) return true;

        // Check 50% rule
        const percentage = @as(f32, @floatFromInt(played_duration)) / @as(f32, @floatFromInt(track_duration));
        return percentage >= MIN_SCROBBLE_PERCENTAGE;
    }
};

// =============================================================================
// Tests
// =============================================================================

test "SettingEntry initialization" {
    const entry = SettingEntry.init();
    try std.testing.expectEqual(@as(u32, 0), entry.key_len);
    try std.testing.expectEqual(@as(u32, 0), entry.value_len);
}

test "SettingEntry setters and getters" {
    var entry = SettingEntry.init();
    entry.setKey("volume");
    entry.setValue("75");

    try std.testing.expectEqualStrings("volume", entry.getKey());
    try std.testing.expectEqualStrings("75", entry.getValue());
}

test "SettingResult found" {
    const result = SettingResult.initFound("theme", "dark");
    try std.testing.expect(result.found);
    try std.testing.expect(result.isSuccess());
    try std.testing.expectEqualStrings("theme", result.entry.getKey());
    try std.testing.expectEqualStrings("dark", result.entry.getValue());
}

test "SettingResult not found" {
    const result = SettingResult.initNotFound();
    try std.testing.expect(!result.found);
    try std.testing.expect(result.isSuccess());
}

test "ScrobbleRecord initialization" {
    const record = ScrobbleRecord.init();
    try std.testing.expectEqual(@as(i64, 0), record.id);
    try std.testing.expect(!record.submitted);
}

test "ScrobbleRecord setters and getters" {
    var record = ScrobbleRecord.init();
    record.setArtist("The Beatles");
    record.setTrack("Hey Jude");
    record.setAlbum("Past Masters");
    record.timestamp = 1234567890;
    record.duration = 431;

    try std.testing.expectEqualStrings("The Beatles", record.getArtist());
    try std.testing.expectEqualStrings("Hey Jude", record.getTrack());
    try std.testing.expectEqualStrings("Past Masters", record.getAlbum());
}

test "ScrobbleQueryResult success" {
    var scrobbles: [2]ScrobbleRecord = undefined;
    scrobbles[0] = ScrobbleRecord.init();
    scrobbles[0].setArtist("Artist 1");
    scrobbles[1] = ScrobbleRecord.init();
    scrobbles[1].setArtist("Artist 2");

    const result = ScrobbleQueryResult.initSuccess(&scrobbles);
    try std.testing.expect(result.isSuccess());
    try std.testing.expectEqual(@as(u32, 2), result.count);
}

test "WatchedFolder initialization" {
    const folder = WatchedFolder.init();
    try std.testing.expectEqual(@as(u32, 0), folder.path_len);
    try std.testing.expect(folder.enabled);
    try std.testing.expectEqual(ScanMode.manual, folder.getScanMode());
}

test "WatchedFolder setters and getters" {
    var folder = WatchedFolder.init();
    folder.setPath("/home/user/music");
    folder.setScanMode(.watch);
    folder.enabled = true;

    try std.testing.expectEqualStrings("/home/user/music", folder.getPath());
    try std.testing.expectEqual(ScanMode.watch, folder.getScanMode());
}

test "WatchedFolderResult success" {
    var folders: [2]WatchedFolder = undefined;
    folders[0] = WatchedFolder.init();
    folders[0].setPath("/music/folder1");
    folders[1] = WatchedFolder.init();
    folders[1].setPath("/music/folder2");

    const result = WatchedFolderResult.initSuccess(&folders);
    try std.testing.expect(result.isSuccess());
    try std.testing.expectEqual(@as(u32, 2), result.count);
}

test "SettingsManager parseBool" {
    const allocator = std.testing.allocator;
    const manager = SettingsManager.init(allocator);
    _ = manager;

    try std.testing.expectEqual(true, SettingsManager.parseBool("true").?);
    try std.testing.expectEqual(true, SettingsManager.parseBool("1").?);
    try std.testing.expectEqual(false, SettingsManager.parseBool("false").?);
    try std.testing.expectEqual(false, SettingsManager.parseBool("0").?);
    try std.testing.expect(SettingsManager.parseBool("invalid") == null);
}

test "SettingsManager parseInt" {
    try std.testing.expectEqual(@as(i32, 42), SettingsManager.parseInt(i32, "42").?);
    try std.testing.expectEqual(@as(i32, -10), SettingsManager.parseInt(i32, "-10").?);
    try std.testing.expect(SettingsManager.parseInt(i32, "not_a_number") == null);
}

test "SettingsManager parseFloat" {
    try std.testing.expectApproxEqAbs(@as(f32, 3.14), SettingsManager.parseFloat(f32, "3.14").?, 0.001);
    try std.testing.expect(SettingsManager.parseFloat(f32, "invalid") == null);
}

test "SettingsManager formatBool" {
    try std.testing.expectEqualStrings("true", SettingsManager.formatBool(true));
    try std.testing.expectEqualStrings("false", SettingsManager.formatBool(false));
}

test "ScrobbleManager isScrobbleEligible 4 minute rule" {
    // 4 minutes played on a 10 minute track - eligible
    try std.testing.expect(ScrobbleManager.isScrobbleEligible(240, 600));

    // 3 minutes played on a 10 minute track - not eligible (under 4 min and under 50%)
    try std.testing.expect(!ScrobbleManager.isScrobbleEligible(180, 600));
}

test "ScrobbleManager isScrobbleEligible 50 percent rule" {
    // 2 minutes played on a 3 minute track - eligible (>50%)
    try std.testing.expect(ScrobbleManager.isScrobbleEligible(120, 180));

    // 1 minute played on a 3 minute track - not eligible (<50% and <4 min)
    try std.testing.expect(!ScrobbleManager.isScrobbleEligible(60, 180));
}

test "ScrobbleManager isScrobbleEligible edge cases" {
    // Zero duration - not eligible
    try std.testing.expect(!ScrobbleManager.isScrobbleEligible(0, 300));
    try std.testing.expect(!ScrobbleManager.isScrobbleEligible(300, 0));

    // Negative values - not eligible
    try std.testing.expect(!ScrobbleManager.isScrobbleEligible(-100, 300));
    try std.testing.expect(!ScrobbleManager.isScrobbleEligible(100, -300));
}
