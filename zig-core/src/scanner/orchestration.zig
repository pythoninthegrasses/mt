//! Scan orchestration - coordinates inventory and progress reporting.
//!
//! Manages the scan pipeline from directory discovery through file categorization.
//! Metadata extraction remains in Rust (via lofty), so this module focuses on
//! inventory and progress coordination.

const std = @import("std");
const types = @import("../types.zig");
const inventory = @import("inventory.zig");
const Allocator = std.mem.Allocator;

// =============================================================================
// Scan Progress Types
// =============================================================================

/// Scan phase identifiers
pub const ScanPhase = enum(u8) {
    inventory = 0,
    parse = 1,
    complete = 2,

    pub fn toString(self: ScanPhase) []const u8 {
        return switch (self) {
            .inventory => "inventory",
            .parse => "parse",
            .complete => "complete",
        };
    }
};

/// Scan progress event (FFI-safe)
pub const ScanProgress = extern struct {
    phase: u8,
    current: u64,
    total: u64,
    filepath: [4096]u8,
    filepath_len: u32,
    message: [256]u8,
    message_len: u32,

    pub fn init(phase: ScanPhase, current: u64, total: u64) ScanProgress {
        var progress = ScanProgress{
            .phase = @intFromEnum(phase),
            .current = current,
            .total = total,
            .filepath = undefined,
            .filepath_len = 0,
            .message = undefined,
            .message_len = 0,
        };
        @memset(&progress.filepath, 0);
        @memset(&progress.message, 0);
        return progress;
    }

    pub fn withFilepath(self: *ScanProgress, path: []const u8) void {
        const len = @min(path.len, self.filepath.len);
        @memcpy(self.filepath[0..len], path[0..len]);
        self.filepath_len = @intCast(len);
    }

    pub fn withMessage(self: *ScanProgress, msg: []const u8) void {
        const len = @min(msg.len, self.message.len);
        @memcpy(self.message[0..len], msg[0..len]);
        self.message_len = @intCast(len);
    }

    pub fn getPhase(self: *const ScanProgress) ScanPhase {
        return @enumFromInt(self.phase);
    }

    pub fn getFilepath(self: *const ScanProgress) []const u8 {
        return self.filepath[0..self.filepath_len];
    }

    pub fn getMessage(self: *const ScanProgress) []const u8 {
        return self.message[0..self.message_len];
    }
};

/// Progress callback function type (C ABI)
pub const ProgressCallback = *const fn (progress: *const ScanProgress) callconv(.C) void;

// =============================================================================
// Scan Statistics
// =============================================================================

/// Scan statistics
pub const ScanStats = extern struct {
    visited: u64,
    added: u64,
    modified: u64,
    unchanged: u64,
    deleted: u64,
    errors: u64,

    pub fn init() ScanStats {
        return .{
            .visited = 0,
            .added = 0,
            .modified = 0,
            .unchanged = 0,
            .deleted = 0,
            .errors = 0,
        };
    }
};

// =============================================================================
// Scan Result
// =============================================================================

/// Result of a 2-phase scan
/// Contains categorized file paths and fingerprints for further processing
pub const ScanResult2Phase = struct {
    /// Files newly added (path + fingerprint)
    added: std.ArrayList(FileWithFingerprint),
    /// Files that were modified (path + fingerprint)
    modified: std.ArrayList(FileWithFingerprint),
    /// Paths of unchanged files
    unchanged: std.ArrayList([]const u8),
    /// Paths of deleted files
    deleted: std.ArrayList([]const u8),
    /// Scan statistics
    stats: ScanStats,
    /// Allocator for cleanup
    allocator: Allocator,

    pub fn init(allocator: Allocator) ScanResult2Phase {
        return .{
            .added = std.ArrayList(FileWithFingerprint).init(allocator),
            .modified = std.ArrayList(FileWithFingerprint).init(allocator),
            .unchanged = std.ArrayList([]const u8).init(allocator),
            .deleted = std.ArrayList([]const u8).init(allocator),
            .stats = ScanStats.init(),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *ScanResult2Phase) void {
        // Free duplicated strings in added
        for (self.added.items) |item| {
            self.allocator.free(item.filepath);
        }
        self.added.deinit();

        // Free duplicated strings in modified
        for (self.modified.items) |item| {
            self.allocator.free(item.filepath);
        }
        self.modified.deinit();

        // Free duplicated strings in unchanged
        for (self.unchanged.items) |path| {
            self.allocator.free(path);
        }
        self.unchanged.deinit();

        // Free duplicated strings in deleted
        for (self.deleted.items) |path| {
            self.allocator.free(path);
        }
        self.deleted.deinit();
    }
};

/// File path with its fingerprint
pub const FileWithFingerprint = struct {
    filepath: []const u8, // Owned, must be freed
    fingerprint: types.FileFingerprint,
};

// =============================================================================
// Scan Orchestrator
// =============================================================================

/// Scan orchestrator - coordinates the scan pipeline
pub const ScanOrchestrator = struct {
    allocator: Allocator,
    progress_callback: ?ProgressCallback,

    /// Initialize a new scan orchestrator
    pub fn init(allocator: Allocator) !*ScanOrchestrator {
        const orchestrator = try allocator.create(ScanOrchestrator);
        orchestrator.* = .{
            .allocator = allocator,
            .progress_callback = null,
        };
        return orchestrator;
    }

    /// Clean up the orchestrator
    pub fn deinit(self: *ScanOrchestrator) void {
        self.allocator.destroy(self);
    }

    /// Set the progress callback for scan events
    pub fn setProgressCallback(self: *ScanOrchestrator, callback: ?ProgressCallback) void {
        self.progress_callback = callback;
    }

    /// Emit a progress event
    fn emitProgress(self: *ScanOrchestrator, progress: *const ScanProgress) void {
        if (self.progress_callback) |callback| {
            callback(progress);
        }
    }

    /// Run inventory-only scan (no metadata extraction)
    /// Returns categorized file lists for Rust to process
    pub fn scanInventory(
        self: *ScanOrchestrator,
        paths: []const []const u8,
        db_fingerprints: []const inventory.DbFingerprint,
        recursive: bool,
    ) !ScanResult2Phase {
        var result = ScanResult2Phase.init(self.allocator);
        errdefer result.deinit();

        // Emit inventory start progress
        var start_progress = ScanProgress.init(.inventory, 0, 0);
        start_progress.withMessage("Starting inventory phase...");
        self.emitProgress(&start_progress);

        // Run inventory (inventory uses a simple visited count callback)
        // We emit progress for start/complete; inventory handles per-file
        const inv_result = try inventory.runInventory(
            self.allocator,
            paths,
            db_fingerprints,
            recursive,
            null, // No per-file progress for now (FFI layer can add if needed)
        );
        defer @constCast(&inv_result).deinit();

        // Convert inventory result to scan result
        // Copy added files
        for (inv_result.added.items) |item| {
            const path_copy = try self.allocator.dupe(u8, item.filepath);
            try result.added.append(.{
                .filepath = path_copy,
                .fingerprint = item.fingerprint,
            });
        }

        // Copy modified files
        for (inv_result.modified.items) |item| {
            const path_copy = try self.allocator.dupe(u8, item.filepath);
            try result.modified.append(.{
                .filepath = path_copy,
                .fingerprint = item.fingerprint,
            });
        }

        // Copy unchanged paths
        for (inv_result.unchanged.items) |path| {
            const path_copy = try self.allocator.dupe(u8, path);
            try result.unchanged.append(path_copy);
        }

        // Copy deleted paths
        for (inv_result.deleted.items) |path| {
            const path_copy = try self.allocator.dupe(u8, path);
            try result.deleted.append(path_copy);
        }

        // Update stats
        result.stats = .{
            .visited = inv_result.stats.visited,
            .added = inv_result.stats.added,
            .modified = inv_result.stats.modified,
            .unchanged = inv_result.stats.unchanged,
            .deleted = inv_result.stats.deleted,
            .errors = 0,
        };

        // Emit complete progress
        var complete_progress = ScanProgress.init(.complete, result.stats.visited, result.stats.visited);
        self.emitProgress(&complete_progress);

        return result;
    }

    /// Run a full 2-phase scan
    /// Phase 1: Inventory (Zig)
    /// Phase 2: Returns files for Rust to extract metadata
    ///
    /// Note: Metadata extraction stays in Rust via lofty, so this returns
    /// the file lists for Rust to process.
    pub fn scan2Phase(
        self: *ScanOrchestrator,
        paths: []const []const u8,
        db_fingerprints: []const inventory.DbFingerprint,
        recursive: bool,
    ) !ScanResult2Phase {
        // Phase 1: Inventory
        const result = try self.scanInventory(paths, db_fingerprints, recursive);

        // Emit parse phase start (Rust will handle actual parsing)
        const total_to_parse = result.added.items.len + result.modified.items.len;
        var parse_progress = ScanProgress.init(.parse, 0, @intCast(total_to_parse));
        parse_progress.withMessage("Ready for metadata extraction...");
        self.emitProgress(&parse_progress);

        // Return result - Rust will call metadata extraction separately
        return result;
    }
};

// =============================================================================
// Standalone Functions
// =============================================================================

/// Build fingerprint map from database tracks (helper for FFI)
/// Input: slice of (filepath, mtime_ns, size) tuples
pub fn buildFingerprintSlice(
    allocator: Allocator,
    tracks: []const DbTrackFingerprint,
) ![]inventory.DbFingerprint {
    var fingerprints = try allocator.alloc(inventory.DbFingerprint, tracks.len);

    for (tracks, 0..) |track, i| {
        fingerprints[i] = .{
            .filepath = track.filepath,
            .fingerprint = inventory.fingerprintFromDb(track.mtime_ns, track.file_size),
        };
    }

    return fingerprints;
}

/// Database track with fingerprint info (FFI-safe)
pub const DbTrackFingerprint = extern struct {
    filepath: [*:0]const u8,
    mtime_ns: ?i64,
    file_size: i64,
};

// =============================================================================
// Tests
// =============================================================================

test "ScanProgress initialization" {
    var progress = ScanProgress.init(.inventory, 5, 10);
    try std.testing.expectEqual(ScanPhase.inventory, progress.getPhase());
    try std.testing.expectEqual(@as(u64, 5), progress.current);
    try std.testing.expectEqual(@as(u64, 10), progress.total);
}

test "ScanProgress with filepath and message" {
    var progress = ScanProgress.init(.parse, 1, 5);
    progress.withFilepath("/music/test.mp3");
    progress.withMessage("Parsing file...");

    try std.testing.expectEqualStrings("/music/test.mp3", progress.getFilepath());
    try std.testing.expectEqualStrings("Parsing file...", progress.getMessage());
}

test "ScanPhase toString" {
    try std.testing.expectEqualStrings("inventory", ScanPhase.inventory.toString());
    try std.testing.expectEqualStrings("parse", ScanPhase.parse.toString());
    try std.testing.expectEqualStrings("complete", ScanPhase.complete.toString());
}

test "ScanStats initialization" {
    const stats = ScanStats.init();
    try std.testing.expectEqual(@as(u64, 0), stats.visited);
    try std.testing.expectEqual(@as(u64, 0), stats.added);
    try std.testing.expectEqual(@as(u64, 0), stats.errors);
}

test "ScanOrchestrator creation" {
    const allocator = std.testing.allocator;

    const orchestrator = try ScanOrchestrator.init(allocator);
    defer orchestrator.deinit();

    try std.testing.expect(orchestrator.progress_callback == null);
}

test "ScanOrchestrator set callback" {
    const allocator = std.testing.allocator;

    const orchestrator = try ScanOrchestrator.init(allocator);
    defer orchestrator.deinit();

    const testCallback = struct {
        fn callback(_: *const ScanProgress) callconv(.C) void {}
    }.callback;

    orchestrator.setProgressCallback(testCallback);
    try std.testing.expect(orchestrator.progress_callback != null);
}

test "ScanResult2Phase initialization" {
    const allocator = std.testing.allocator;

    var result = ScanResult2Phase.init(allocator);
    defer result.deinit();

    try std.testing.expectEqual(@as(usize, 0), result.added.items.len);
    try std.testing.expectEqual(@as(usize, 0), result.modified.items.len);
    try std.testing.expectEqual(@as(usize, 0), result.unchanged.items.len);
    try std.testing.expectEqual(@as(usize, 0), result.deleted.items.len);
}

test "ScanOrchestrator scanInventory empty" {
    const allocator = std.testing.allocator;

    const orchestrator = try ScanOrchestrator.init(allocator);
    defer orchestrator.deinit();

    // Create a temporary empty directory
    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();

    const tmp_path = try tmp_dir.dir.realpathAlloc(allocator, ".");
    defer allocator.free(tmp_path);

    const paths = [_][]const u8{tmp_path};
    const db_fingerprints = [_]inventory.DbFingerprint{};

    var result = try orchestrator.scanInventory(&paths, &db_fingerprints, true);
    defer result.deinit();

    try std.testing.expectEqual(@as(u64, 0), result.stats.added);
    try std.testing.expectEqual(@as(u64, 0), result.stats.deleted);
}

test "ScanOrchestrator scanInventory with files" {
    const allocator = std.testing.allocator;

    const orchestrator = try ScanOrchestrator.init(allocator);
    defer orchestrator.deinit();

    // Create a temporary directory with test files
    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();

    // Create test audio files
    try tmp_dir.dir.writeFile(.{ .sub_path = "test1.mp3", .data = "fake mp3 content" });
    try tmp_dir.dir.writeFile(.{ .sub_path = "test2.flac", .data = "fake flac content" });

    const tmp_path = try tmp_dir.dir.realpathAlloc(allocator, ".");
    defer allocator.free(tmp_path);

    const paths = [_][]const u8{tmp_path};
    const db_fingerprints = [_]inventory.DbFingerprint{};

    var result = try orchestrator.scanInventory(&paths, &db_fingerprints, true);
    defer result.deinit();

    // Should have found 2 new files
    try std.testing.expectEqual(@as(u64, 2), result.stats.added);
    try std.testing.expectEqual(@as(usize, 2), result.added.items.len);
}

test "ScanOrchestrator progress callback invoked" {
    const allocator = std.testing.allocator;

    const orchestrator = try ScanOrchestrator.init(allocator);
    defer orchestrator.deinit();

    const CallbackState = struct {
        var count: u32 = 0;
    };
    CallbackState.count = 0;

    const testCallback = struct {
        fn callback(_: *const ScanProgress) callconv(.C) void {
            CallbackState.count += 1;
        }
    }.callback;

    orchestrator.setProgressCallback(testCallback);

    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();

    const tmp_path = try tmp_dir.dir.realpathAlloc(allocator, ".");
    defer allocator.free(tmp_path);

    const paths = [_][]const u8{tmp_path};
    const db_fingerprints = [_]inventory.DbFingerprint{};

    var result = try orchestrator.scanInventory(&paths, &db_fingerprints, true);
    defer result.deinit();

    // Should have received at least start and complete callbacks
    try std.testing.expect(CallbackState.count >= 2);
}
