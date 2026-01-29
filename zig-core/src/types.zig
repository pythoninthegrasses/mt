//! Core types for mt-core library
//!
//! These types mirror the Rust ExtractedMetadata and related structs,
//! designed for efficient FFI transfer.

const std = @import("std");

/// Supported audio file extensions
pub const audio_extensions = [_][]const u8{
    ".mp3", ".m4a", ".flac", ".ogg", ".wav",
    ".aac", ".wma", ".opus", ".ape", ".aiff",
};

/// Check if a path has a supported audio extension
pub fn isAudioFile(path: []const u8) bool {
    const ext_start = std.mem.lastIndexOfScalar(u8, path, '.') orelse return false;
    const ext = path[ext_start..];

    var lower_buf: [16]u8 = undefined;
    const ext_lower = std.ascii.lowerString(&lower_buf, ext);

    for (audio_extensions) |supported| {
        if (std.mem.eql(u8, ext_lower, supported)) {
            return true;
        }
    }
    return false;
}

/// File fingerprint for change detection
pub const FileFingerprint = extern struct {
    /// Modification time in nanoseconds since Unix epoch (0 if unavailable)
    mtime_ns: i64,
    /// File size in bytes
    size: i64,
    /// Inode number (0 if unavailable, Unix only)
    inode: u64,
    /// Whether mtime_ns is valid
    has_mtime: bool,
    /// Whether inode is valid
    has_inode: bool,

    pub fn matches(self: FileFingerprint, other: FileFingerprint) bool {
        if (self.has_mtime != other.has_mtime) return false;
        if (self.has_mtime and self.mtime_ns != other.mtime_ns) return false;
        return self.size == other.size;
    }
};

/// Extracted metadata from an audio file
/// Uses fixed-size buffers for FFI safety - no allocations cross the boundary
pub const ExtractedMetadata = extern struct {
    // File info
    filepath: [4096]u8,
    filepath_len: u32,
    file_size: i64,
    file_mtime_ns: i64,
    file_inode: u64,
    has_mtime: bool,
    has_inode: bool,

    // Basic tags
    title: [512]u8,
    title_len: u32,
    artist: [512]u8,
    artist_len: u32,
    album: [512]u8,
    album_len: u32,
    album_artist: [512]u8,
    album_artist_len: u32,

    // Track info
    track_number: [32]u8,
    track_number_len: u32,
    track_total: [32]u8,
    track_total_len: u32,
    disc_number: u32,
    disc_total: u32,
    has_disc_number: bool,
    has_disc_total: bool,

    // Date/genre
    date: [64]u8,
    date_len: u32,
    genre: [256]u8,
    genre_len: u32,

    // Audio properties
    duration_secs: f64,
    bitrate: u32,
    sample_rate: u32,
    channels: u8,
    has_duration: bool,
    has_bitrate: bool,
    has_sample_rate: bool,
    has_channels: bool,

    // Status
    is_valid: bool,
    error_code: u32,

    const Self = @This();

    pub fn init() Self {
        return std.mem.zeroes(Self);
    }

    /// Get title as a slice (for Zig-side use)
    pub fn getTitle(self: *const Self) []const u8 {
        return self.title[0..self.title_len];
    }

    /// Get artist as a slice
    pub fn getArtist(self: *const Self) []const u8 {
        return self.artist[0..self.artist_len];
    }

    /// Get album as a slice
    pub fn getAlbum(self: *const Self) []const u8 {
        return self.album[0..self.album_len];
    }

    /// Get filepath as a slice
    pub fn getFilepath(self: *const Self) []const u8 {
        return self.filepath[0..self.filepath_len];
    }

    /// Set a string field from a slice
    fn setString(dest: []u8, len_ptr: *u32, src: []const u8) void {
        const copy_len = @min(src.len, dest.len);
        @memcpy(dest[0..copy_len], src[0..copy_len]);
        len_ptr.* = @intCast(copy_len);
    }

    pub fn setTitle(self: *Self, value: []const u8) void {
        setString(&self.title, &self.title_len, value);
    }

    pub fn setArtist(self: *Self, value: []const u8) void {
        setString(&self.artist, &self.artist_len, value);
    }

    pub fn setAlbum(self: *Self, value: []const u8) void {
        setString(&self.album, &self.album_len, value);
    }

    pub fn setAlbumArtist(self: *Self, value: []const u8) void {
        setString(&self.album_artist, &self.album_artist_len, value);
    }

    pub fn setFilepath(self: *Self, value: []const u8) void {
        setString(&self.filepath, &self.filepath_len, value);
    }

    pub fn setGenre(self: *Self, value: []const u8) void {
        setString(&self.genre, &self.genre_len, value);
    }

    pub fn setDate(self: *Self, value: []const u8) void {
        setString(&self.date, &self.date_len, value);
    }

    pub fn setTrackNumber(self: *Self, value: []const u8) void {
        setString(&self.track_number, &self.track_number_len, value);
    }

    pub fn setTrackTotal(self: *Self, value: []const u8) void {
        setString(&self.track_total, &self.track_total_len, value);
    }
};

/// Error codes for scanner operations
pub const ScanError = enum(u32) {
    none = 0,
    io_error = 1,
    metadata_error = 2,
    database_error = 3,
    path_not_found = 4,
    unsupported_format = 5,
    taglib_error = 6,
};

/// Scan statistics
pub const ScanStats = extern struct {
    visited: u64,
    added: u64,
    modified: u64,
    unchanged: u64,
    deleted: u64,
    errors: u64,
};

test "isAudioFile" {
    try std.testing.expect(isAudioFile("song.mp3"));
    try std.testing.expect(isAudioFile("song.MP3"));
    try std.testing.expect(isAudioFile("song.flac"));
    try std.testing.expect(isAudioFile("/path/to/music/track.m4a"));
    try std.testing.expect(!isAudioFile("image.jpg"));
    try std.testing.expect(!isAudioFile("noext"));
}

test "ExtractedMetadata setters and getters" {
    var m = ExtractedMetadata.init();
    m.setTitle("Test Song");
    m.setArtist("Test Artist");

    try std.testing.expectEqualStrings("Test Song", m.getTitle());
    try std.testing.expectEqualStrings("Test Artist", m.getArtist());
}

test "FileFingerprint matches" {
    const fp1 = FileFingerprint{
        .mtime_ns = 1234567890,
        .size = 1000,
        .inode = 12345,
        .has_mtime = true,
        .has_inode = true,
    };

    const fp2 = FileFingerprint{
        .mtime_ns = 1234567890,
        .size = 1000,
        .inode = 99999, // Different inode - should still match
        .has_mtime = true,
        .has_inode = true,
    };

    const fp3 = FileFingerprint{
        .mtime_ns = 1234567890,
        .size = 2000, // Different size
        .inode = 12345,
        .has_mtime = true,
        .has_inode = true,
    };

    try std.testing.expect(fp1.matches(fp2));
    try std.testing.expect(!fp1.matches(fp3));
}
