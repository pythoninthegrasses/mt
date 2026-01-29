//! Metadata extraction using TagLib.
//!
//! Extracts audio metadata from files using the TagLib C bindings.

const std = @import("std");
const types = @import("../types.zig");
const fingerprint = @import("fingerprint.zig");
const ExtractedMetadata = types.ExtractedMetadata;
const FileFingerprint = types.FileFingerprint;
const ScanError = types.ScanError;

// TagLib C API bindings
const c = @cImport({
    @cInclude("taglib/tag_c.h");
});

/// Extract metadata from a single audio file
pub fn extractMetadata(filepath: []const u8) ExtractedMetadata {
    var metadata = ExtractedMetadata.init();
    metadata.setFilepath(filepath);

    // Get file fingerprint
    const fp = fingerprint.fromPath(filepath) catch |err| {
        metadata.error_code = switch (err) {
            error.FileNotFound => @intFromEnum(ScanError.path_not_found),
            else => @intFromEnum(ScanError.io_error),
        };
        setTitleFromFilename(&metadata, filepath);
        return metadata;
    };

    metadata.file_size = fp.size;
    metadata.file_mtime_ns = fp.mtime_ns;
    metadata.file_inode = fp.inode;
    metadata.has_mtime = fp.has_mtime;
    metadata.has_inode = fp.has_inode;

    // Need null-terminated path for TagLib
    var path_buf: [4096]u8 = undefined;
    const path_z = std.fmt.bufPrintZ(&path_buf, "{s}", .{filepath}) catch {
        metadata.error_code = @intFromEnum(ScanError.io_error);
        setTitleFromFilename(&metadata, filepath);
        return metadata;
    };

    // Open file with TagLib
    const file = c.taglib_file_new(path_z.ptr);
    if (file == null) {
        metadata.error_code = @intFromEnum(ScanError.taglib_error);
        setTitleFromFilename(&metadata, filepath);
        return metadata;
    }
    defer c.taglib_file_free(file);

    if (c.taglib_file_is_valid(file) == 0) {
        metadata.error_code = @intFromEnum(ScanError.unsupported_format);
        setTitleFromFilename(&metadata, filepath);
        return metadata;
    }

    // Get audio properties
    const properties = c.taglib_file_audioproperties(file);
    if (properties != null) {
        const length = c.taglib_audioproperties_length(properties);
        if (length > 0) {
            metadata.duration_secs = @floatFromInt(length);
            metadata.has_duration = true;
        }

        const bitrate = c.taglib_audioproperties_bitrate(properties);
        if (bitrate > 0) {
            metadata.bitrate = @intCast(bitrate);
            metadata.has_bitrate = true;
        }

        const sample_rate = c.taglib_audioproperties_samplerate(properties);
        if (sample_rate > 0) {
            metadata.sample_rate = @intCast(sample_rate);
            metadata.has_sample_rate = true;
        }

        const channels = c.taglib_audioproperties_channels(properties);
        if (channels > 0) {
            metadata.channels = @intCast(channels);
            metadata.has_channels = true;
        }
    }

    // Get tags
    const tag = c.taglib_file_tag(file);
    if (tag != null) {
        extractTag(&metadata, tag);
    }

    // Fallback: use filename as title if none found
    if (metadata.title_len == 0) {
        setTitleFromFilename(&metadata, filepath);
    }

    metadata.is_valid = true;
    return metadata;
}

/// Helper to extract tag strings from TagLib
fn extractTag(metadata: *ExtractedMetadata, tag: *c.TagLib_Tag) void {
    // Title
    const title = c.taglib_tag_title(tag);
    if (title != null) {
        const title_slice = std.mem.span(title);
        if (title_slice.len > 0) {
            metadata.setTitle(title_slice);
        }
        c.taglib_free(title);
    }

    // Artist
    const artist = c.taglib_tag_artist(tag);
    if (artist != null) {
        const artist_slice = std.mem.span(artist);
        if (artist_slice.len > 0) {
            metadata.setArtist(artist_slice);
        }
        c.taglib_free(artist);
    }

    // Album
    const album = c.taglib_tag_album(tag);
    if (album != null) {
        const album_slice = std.mem.span(album);
        if (album_slice.len > 0) {
            metadata.setAlbum(album_slice);
        }
        c.taglib_free(album);
    }

    // Genre
    const genre = c.taglib_tag_genre(tag);
    if (genre != null) {
        const genre_slice = std.mem.span(genre);
        if (genre_slice.len > 0) {
            metadata.setGenre(genre_slice);
        }
        c.taglib_free(genre);
    }

    // Year -> date
    const year = c.taglib_tag_year(tag);
    if (year > 0) {
        var year_buf: [32]u8 = undefined;
        const year_str = std.fmt.bufPrint(&year_buf, "{d}", .{year}) catch "";
        if (year_str.len > 0) {
            metadata.setDate(year_str);
        }
    }

    // Track number
    const track = c.taglib_tag_track(tag);
    if (track > 0) {
        var track_buf: [32]u8 = undefined;
        const track_str = std.fmt.bufPrint(&track_buf, "{d}", .{track}) catch "";
        if (track_str.len > 0) {
            metadata.setTrackNumber(track_str);
        }
    }
}

/// Extract filename (without extension) as fallback title
fn setTitleFromFilename(metadata: *ExtractedMetadata, filepath: []const u8) void {
    // Find last path separator
    const name_start = if (std.mem.lastIndexOfScalar(u8, filepath, '/')) |idx|
        idx + 1
    else if (std.mem.lastIndexOfScalar(u8, filepath, '\\')) |idx|
        idx + 1
    else
        0;

    const filename = filepath[name_start..];

    // Remove extension
    const name_end = std.mem.lastIndexOfScalar(u8, filename, '.') orelse filename.len;
    const stem = filename[0..name_end];

    if (stem.len > 0) {
        metadata.setTitle(stem);
    } else {
        metadata.setTitle("Unknown");
    }
}

/// Thread pool for parallel extraction
const ThreadPool = struct {
    threads: []std.Thread,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, thread_count: usize) !ThreadPool {
        const threads = try allocator.alloc(std.Thread, thread_count);
        return ThreadPool{
            .threads = threads,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *ThreadPool) void {
        self.allocator.free(self.threads);
    }
};

/// Batch extraction with parallelism
pub fn extractMetadataBatch(
    allocator: std.mem.Allocator,
    filepaths: []const []const u8,
) ![]ExtractedMetadata {
    const results = try allocator.alloc(ExtractedMetadata, filepaths.len);

    // For small batches, process serially
    if (filepaths.len < 20) {
        for (filepaths, 0..) |path, i| {
            results[i] = extractMetadata(path);
        }
        return results;
    }

    // For larger batches, use thread pool
    const thread_count = @min(std.Thread.getCpuCount() catch 4, filepaths.len);
    const chunk_size = (filepaths.len + thread_count - 1) / thread_count;

    var threads: [32]std.Thread = undefined;
    var active_threads: usize = 0;

    var i: usize = 0;
    while (i < filepaths.len) : (i += chunk_size) {
        const end = @min(i + chunk_size, filepaths.len);
        const chunk_paths = filepaths[i..end];
        const chunk_results = results[i..end];

        threads[active_threads] = try std.Thread.spawn(.{}, processChunk, .{
            chunk_paths,
            chunk_results,
        });
        active_threads += 1;
    }

    // Wait for all threads
    for (threads[0..active_threads]) |thread| {
        thread.join();
    }

    return results;
}

fn processChunk(paths: []const []const u8, results: []ExtractedMetadata) void {
    for (paths, 0..) |path, i| {
        results[i] = extractMetadata(path);
    }
}

test "extractMetadata nonexistent file" {
    const metadata = extractMetadata("/nonexistent/file.mp3");
    try std.testing.expect(!metadata.is_valid);
    try std.testing.expect(metadata.error_code != 0);
}

test "setTitleFromFilename" {
    var m = ExtractedMetadata.init();

    setTitleFromFilename(&m, "/path/to/song.mp3");
    try std.testing.expectEqualStrings("song", m.getTitle());

    setTitleFromFilename(&m, "track.flac");
    try std.testing.expectEqualStrings("track", m.getTitle());

    setTitleFromFilename(&m, "/path/to/noext");
    try std.testing.expectEqualStrings("noext", m.getTitle());
}
