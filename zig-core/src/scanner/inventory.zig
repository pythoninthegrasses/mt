//! Directory inventory scanning for music files.
//!
//! Phase 1 of the scan pipeline: walks the filesystem, collects file stats,
//! and compares fingerprints with the database to classify files as
//! added/modified/unchanged/deleted.

const std = @import("std");
const types = @import("../types.zig");
const Allocator = std.mem.Allocator;

/// Progress callback type
pub const ProgressCallback = ?*const fn (visited: usize) callconv(.C) void;

/// Entry representing a file and its fingerprint
pub const FileEntry = struct {
    filepath: []const u8,
    fingerprint: types.FileFingerprint,
};

/// Result of the inventory phase
pub const InventoryResult = struct {
    /// New files not in database (filepath, fingerprint)
    added: std.ArrayList(FileEntry),
    /// Files with changed fingerprint (filepath, new_fingerprint)
    modified: std.ArrayList(FileEntry),
    /// Files with unchanged fingerprint
    unchanged: std.ArrayList([]const u8),
    /// Files in DB but not on filesystem
    deleted: std.ArrayList([]const u8),
    /// Statistics
    stats: types.ScanStats,

    allocator: Allocator,

    pub fn init(allocator: Allocator) InventoryResult {
        return .{
            .added = std.ArrayList(FileEntry).init(allocator),
            .modified = std.ArrayList(FileEntry).init(allocator),
            .unchanged = std.ArrayList([]const u8).init(allocator),
            .deleted = std.ArrayList([]const u8).init(allocator),
            .stats = std.mem.zeroes(types.ScanStats),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *InventoryResult) void {
        // Free duplicated filepath strings in added/modified
        for (self.added.items) |entry| {
            self.allocator.free(entry.filepath);
        }
        for (self.modified.items) |entry| {
            self.allocator.free(entry.filepath);
        }
        for (self.unchanged.items) |filepath| {
            self.allocator.free(filepath);
        }
        for (self.deleted.items) |filepath| {
            self.allocator.free(filepath);
        }

        self.added.deinit();
        self.modified.deinit();
        self.unchanged.deinit();
        self.deleted.deinit();
    }
};

/// Scan results for legacy API
pub const ScanResults = extern struct {
    files_found: u64,
    files_excluded: u64,
    directories_scanned: u64,
    errors: u64,
};

/// Database fingerprint entry for comparison
pub const DbFingerprint = struct {
    filepath: []const u8,
    fingerprint: types.FileFingerprint,
};

/// Run inventory phase on given paths.
///
/// Walks the filesystem, collects fingerprints, and compares with database
/// to determine which files need metadata extraction.
pub fn runInventory(
    allocator: Allocator,
    paths: []const []const u8,
    db_fingerprints: []const DbFingerprint,
    recursive: bool,
    progress_fn: ProgressCallback,
) !InventoryResult {
    var result = InventoryResult.init(allocator);
    errdefer result.deinit();

    // Build a map of database fingerprints for fast lookup
    var db_map = std.StringHashMap(types.FileFingerprint).init(allocator);
    defer db_map.deinit();

    for (db_fingerprints) |entry| {
        try db_map.put(entry.filepath, entry.fingerprint);
    }

    // Collect filesystem files
    var filesystem_files = std.StringHashMap(types.FileFingerprint).init(allocator);
    defer {
        // Free the keys we allocated
        var it = filesystem_files.iterator();
        while (it.next()) |entry| {
            allocator.free(entry.key_ptr.*);
        }
        filesystem_files.deinit();
    }

    // Walk each path
    for (paths) |path| {
        try walkPath(allocator, path, recursive, &filesystem_files, &result.stats, progress_fn);
    }

    // Classify files by comparing fingerprints
    var fs_it = filesystem_files.iterator();
    while (fs_it.next()) |entry| {
        const filepath = entry.key_ptr.*;
        const fs_fingerprint = entry.value_ptr.*;

        if (db_map.get(filepath)) |db_fingerprint| {
            if (fs_fingerprint.matches(db_fingerprint)) {
                // File exists with same fingerprint - unchanged
                const filepath_copy = try allocator.dupe(u8, filepath);
                try result.unchanged.append(filepath_copy);
                result.stats.unchanged += 1;
            } else {
                // File exists but fingerprint changed - modified
                const filepath_copy = try allocator.dupe(u8, filepath);
                try result.modified.append(.{
                    .filepath = filepath_copy,
                    .fingerprint = fs_fingerprint,
                });
                result.stats.modified += 1;
            }
        } else {
            // New file - not in DB - added
            const filepath_copy = try allocator.dupe(u8, filepath);
            try result.added.append(.{
                .filepath = filepath_copy,
                .fingerprint = fs_fingerprint,
            });
            result.stats.added += 1;
        }
    }

    // Find deleted files (in DB but not on filesystem)
    for (db_fingerprints) |db_entry| {
        if (!filesystem_files.contains(db_entry.filepath)) {
            const filepath_copy = try allocator.dupe(u8, db_entry.filepath);
            try result.deleted.append(filepath_copy);
            result.stats.deleted += 1;
        }
    }

    return result;
}

/// Walk a single path (file or directory)
fn walkPath(
    allocator: Allocator,
    path: []const u8,
    recursive: bool,
    filesystem_files: *std.StringHashMap(types.FileFingerprint),
    stats: *types.ScanStats,
    progress_fn: ProgressCallback,
) !void {
    // Check if path exists
    const stat_result = std.fs.cwd().statFile(path) catch |err| {
        if (err == error.FileNotFound) {
            return; // Path doesn't exist, skip
        }
        stats.errors += 1;
        return;
    };

    if (stat_result.kind == .file) {
        // Single file
        if (types.isAudioFile(path)) {
            const fingerprint = fingerprintFromStat(stat_result);
            const filepath_copy = try allocator.dupe(u8, path);
            try filesystem_files.put(filepath_copy, fingerprint);
            stats.visited += 1;

            if (progress_fn) |callback| {
                callback(stats.visited);
            }
        }
    } else if (stat_result.kind == .directory) {
        // Directory - scan for audio files
        try walkDirectory(allocator, path, recursive, filesystem_files, stats, progress_fn);
    }
}

/// Walk a directory for audio files
fn walkDirectory(
    allocator: Allocator,
    dir_path: []const u8,
    recursive: bool,
    filesystem_files: *std.StringHashMap(types.FileFingerprint),
    stats: *types.ScanStats,
    progress_fn: ProgressCallback,
) !void {
    var dir = std.fs.cwd().openDir(dir_path, .{ .iterate = true }) catch |err| {
        if (err == error.AccessDenied or err == error.FileNotFound) {
            return;
        }
        stats.errors += 1;
        return;
    };
    defer dir.close();

    var walker = dir.iterate();
    while (walker.next() catch null) |entry| {
        // Build full path
        var path_buf: [std.fs.max_path_bytes]u8 = undefined;
        const full_path = std.fmt.bufPrint(&path_buf, "{s}/{s}", .{ dir_path, entry.name }) catch continue;

        if (entry.kind == .file) {
            if (types.isAudioFile(full_path)) {
                // Get file stat for fingerprint
                const stat_result = std.fs.cwd().statFile(full_path) catch {
                    stats.errors += 1;
                    continue;
                };

                const fingerprint = fingerprintFromStat(stat_result);
                const filepath_copy = try allocator.dupe(u8, full_path);
                try filesystem_files.put(filepath_copy, fingerprint);
                stats.visited += 1;

                if (progress_fn) |callback| {
                    callback(stats.visited);
                }
            }
        } else if (entry.kind == .directory and recursive) {
            // Recurse into subdirectory
            try walkDirectory(allocator, full_path, recursive, filesystem_files, stats, progress_fn);
        } else if (entry.kind == .sym_link) {
            // Follow symlinks (like Rust's follow_links(true))
            const link_stat = std.fs.cwd().statFile(full_path) catch continue;
            if (link_stat.kind == .file and types.isAudioFile(full_path)) {
                const fingerprint = fingerprintFromStat(link_stat);
                const filepath_copy = try allocator.dupe(u8, full_path);
                try filesystem_files.put(filepath_copy, fingerprint);
                stats.visited += 1;

                if (progress_fn) |callback| {
                    callback(stats.visited);
                }
            } else if (link_stat.kind == .directory and recursive) {
                try walkDirectory(allocator, full_path, recursive, filesystem_files, stats, progress_fn);
            }
        }
    }
}

/// Create a FileFingerprint from stat result
fn fingerprintFromStat(stat: std.fs.File.Stat) types.FileFingerprint {
    // stat.mtime is i128, but we use i64 for FFI compatibility
    // Current timestamps fit in i64 (max ~292 years from 1970)
    const mtime: i64 = @intCast(stat.mtime);
    return .{
        .mtime_ns = mtime,
        .size = @intCast(stat.size),
        .inode = stat.inode,
        .has_mtime = true,
        .has_inode = stat.inode != 0,
    };
}

/// Create a FileFingerprint from database values
pub fn fingerprintFromDb(mtime_ns: ?i64, size: i64) types.FileFingerprint {
    return .{
        .mtime_ns = mtime_ns orelse 0,
        .size = size,
        .inode = 0,
        .has_mtime = mtime_ns != null,
        .has_inode = false,
    };
}

// =============================================================================
// Legacy API for compatibility with skeleton
// =============================================================================

/// Inventory scanner (legacy API)
pub const InventoryScanner = struct {
    allocator: Allocator,
    result: ?InventoryResult,
    recursive: bool,

    pub fn init(allocator: Allocator) !*InventoryScanner {
        const scanner = try allocator.create(InventoryScanner);
        scanner.* = .{
            .allocator = allocator,
            .result = null,
            .recursive = true,
        };
        return scanner;
    }

    pub fn deinit(self: *InventoryScanner) void {
        if (self.result) |*result| {
            result.deinit();
        }
        self.allocator.destroy(self);
    }

    pub fn scanDirectory(
        self: *InventoryScanner,
        path: [*:0]const u8,
        results: *ScanResults,
    ) !void {
        const path_slice = std.mem.span(path);

        // Clear previous result
        if (self.result) |*result| {
            result.deinit();
        }

        // Run inventory with empty DB (all files are "new")
        const empty_db: []const DbFingerprint = &.{};
        self.result = try runInventory(
            self.allocator,
            &.{path_slice},
            empty_db,
            self.recursive,
            null,
        );

        // Populate legacy results
        results.files_found = self.result.?.stats.visited;
        results.files_excluded = 0;
        results.directories_scanned = 0; // Not tracked in new API
        results.errors = self.result.?.stats.errors;
    }

    pub fn getFiles(self: *InventoryScanner) []const FileEntry {
        if (self.result) |*result| {
            return result.added.items;
        }
        return &.{};
    }

    pub fn setRecursive(self: *InventoryScanner, recursive: bool) void {
        self.recursive = recursive;
    }
};

// =============================================================================
// Tests
// =============================================================================

test "InventoryScanner creation" {
    const allocator = std.testing.allocator;

    const scanner = try InventoryScanner.init(allocator);
    defer scanner.deinit();

    try std.testing.expect(scanner.result == null);
}

test "runInventory empty directory" {
    const allocator = std.testing.allocator;

    // Create a temporary directory
    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();

    const path = try tmp_dir.dir.realpathAlloc(allocator, ".");
    defer allocator.free(path);

    const empty_db: []const DbFingerprint = &.{};
    var result = try runInventory(allocator, &.{path}, empty_db, true, null);
    defer result.deinit();

    try std.testing.expectEqual(@as(u64, 0), result.stats.visited);
    try std.testing.expectEqual(@as(u64, 0), result.stats.added);
    try std.testing.expectEqual(@as(usize, 0), result.added.items.len);
}

test "runInventory finds audio files" {
    const allocator = std.testing.allocator;

    // Create a temporary directory
    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();

    // Create test audio files
    try tmp_dir.dir.writeFile(.{ .sub_path = "song1.mp3", .data = "fake mp3" });
    try tmp_dir.dir.writeFile(.{ .sub_path = "song2.flac", .data = "fake flac" });
    try tmp_dir.dir.writeFile(.{ .sub_path = "image.jpg", .data = "fake image" }); // Should be ignored

    const path = try tmp_dir.dir.realpathAlloc(allocator, ".");
    defer allocator.free(path);

    const empty_db: []const DbFingerprint = &.{};
    var result = try runInventory(allocator, &.{path}, empty_db, true, null);
    defer result.deinit();

    try std.testing.expectEqual(@as(u64, 2), result.stats.visited); // Only audio files
    try std.testing.expectEqual(@as(u64, 2), result.stats.added);
    try std.testing.expectEqual(@as(usize, 2), result.added.items.len);
}

test "runInventory detects unchanged files" {
    const allocator = std.testing.allocator;

    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();

    // Create test audio file
    try tmp_dir.dir.writeFile(.{ .sub_path = "song.mp3", .data = "fake mp3" });

    const path = try tmp_dir.dir.realpathAlloc(allocator, ".");
    defer allocator.free(path);

    var filepath_buf: [std.fs.max_path_bytes]u8 = undefined;
    const filepath = try std.fmt.bufPrint(&filepath_buf, "{s}/song.mp3", .{path});

    // Get the actual fingerprint of the file
    const stat = try std.fs.cwd().statFile(filepath);
    const actual_fp = fingerprintFromStat(stat);

    // Create DB fingerprint matching the actual file
    const db_fingerprints = [_]DbFingerprint{
        .{
            .filepath = filepath,
            .fingerprint = actual_fp,
        },
    };

    var result = try runInventory(allocator, &.{path}, &db_fingerprints, true, null);
    defer result.deinit();

    try std.testing.expectEqual(@as(u64, 1), result.stats.visited);
    try std.testing.expectEqual(@as(u64, 1), result.stats.unchanged);
    try std.testing.expectEqual(@as(usize, 1), result.unchanged.items.len);
    try std.testing.expectEqual(@as(usize, 0), result.added.items.len);
    try std.testing.expectEqual(@as(usize, 0), result.modified.items.len);
}

test "runInventory detects deleted files" {
    const allocator = std.testing.allocator;

    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();

    const path = try tmp_dir.dir.realpathAlloc(allocator, ".");
    defer allocator.free(path);

    // DB has a file that doesn't exist on filesystem
    const db_fingerprints = [_]DbFingerprint{
        .{
            .filepath = "/nonexistent/song.mp3",
            .fingerprint = fingerprintFromDb(1234567890, 1000),
        },
    };

    var result = try runInventory(allocator, &.{path}, &db_fingerprints, true, null);
    defer result.deinit();

    try std.testing.expectEqual(@as(u64, 1), result.stats.deleted);
    try std.testing.expectEqual(@as(usize, 1), result.deleted.items.len);
}

test "runInventory detects modified files" {
    const allocator = std.testing.allocator;

    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();

    // Create test audio file
    try tmp_dir.dir.writeFile(.{ .sub_path = "song.mp3", .data = "fake mp3" });

    const path = try tmp_dir.dir.realpathAlloc(allocator, ".");
    defer allocator.free(path);

    var filepath_buf: [std.fs.max_path_bytes]u8 = undefined;
    const filepath = try std.fmt.bufPrint(&filepath_buf, "{s}/song.mp3", .{path});

    // DB has different fingerprint (different size)
    const db_fingerprints = [_]DbFingerprint{
        .{
            .filepath = filepath,
            .fingerprint = fingerprintFromDb(null, 9999), // Wrong size
        },
    };

    var result = try runInventory(allocator, &.{path}, &db_fingerprints, true, null);
    defer result.deinit();

    try std.testing.expectEqual(@as(u64, 1), result.stats.visited);
    try std.testing.expectEqual(@as(u64, 1), result.stats.modified);
    try std.testing.expectEqual(@as(usize, 1), result.modified.items.len);
}

test "runInventory non-recursive mode" {
    const allocator = std.testing.allocator;

    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();

    // Create files in root and subdirectory
    try tmp_dir.dir.writeFile(.{ .sub_path = "song1.mp3", .data = "fake mp3" });
    try tmp_dir.dir.makeDir("subdir");
    try tmp_dir.dir.writeFile(.{ .sub_path = "subdir/song2.mp3", .data = "fake mp3" });

    const path = try tmp_dir.dir.realpathAlloc(allocator, ".");
    defer allocator.free(path);

    const empty_db: []const DbFingerprint = &.{};

    // Non-recursive should only find song1.mp3
    var result = try runInventory(allocator, &.{path}, empty_db, false, null);
    defer result.deinit();

    try std.testing.expectEqual(@as(u64, 1), result.stats.visited);
    try std.testing.expectEqual(@as(u64, 1), result.stats.added);
}

test "fingerprintFromDb" {
    const fp = fingerprintFromDb(1234567890, 1000);

    try std.testing.expectEqual(@as(i64, 1234567890), fp.mtime_ns);
    try std.testing.expectEqual(@as(i64, 1000), fp.size);
    try std.testing.expect(fp.has_mtime);
    try std.testing.expect(!fp.has_inode);
}
