//! File fingerprinting for change detection.
//!
//! Uses file modification time (mtime_ns) and file size as a fingerprint
//! to detect changes without reading file contents.

const std = @import("std");
const types = @import("../types.zig");
const FileFingerprint = types.FileFingerprint;

/// Get file fingerprint from path
pub fn fromPath(path: []const u8) !FileFingerprint {
    // Need null-terminated path for std.fs
    var path_buf: [4096]u8 = undefined;
    const path_z = std.fmt.bufPrintZ(&path_buf, "{s}", .{path}) catch {
        return error.PathTooLong;
    };

    const file = std.fs.cwd().openFile(path_z, .{}) catch |err| {
        return switch (err) {
            error.FileNotFound => error.FileNotFound,
            else => error.AccessDenied,
        };
    };
    defer file.close();

    const stat = try file.stat();

    return FileFingerprint{
        .mtime_ns = @intCast(stat.mtime),
        .size = @intCast(stat.size),
        .inode = stat.inode,
        .has_mtime = true,
        .has_inode = stat.inode != 0,
    };
}

/// Create fingerprint from database values (no inode)
pub fn fromDb(mtime_ns: ?i64, size: i64) FileFingerprint {
    return FileFingerprint{
        .mtime_ns = mtime_ns orelse 0,
        .size = size,
        .inode = 0,
        .has_mtime = mtime_ns != null,
        .has_inode = false,
    };
}

/// Create fingerprint from database values with inode
pub fn fromDbWithInode(mtime_ns: ?i64, size: i64, inode: ?u64) FileFingerprint {
    return FileFingerprint{
        .mtime_ns = mtime_ns orelse 0,
        .size = size,
        .inode = inode orelse 0,
        .has_mtime = mtime_ns != null,
        .has_inode = inode != null,
    };
}

test "fromDb" {
    const fp = fromDb(1234567890, 5000);
    try std.testing.expectEqual(@as(i64, 1234567890), fp.mtime_ns);
    try std.testing.expectEqual(@as(i64, 5000), fp.size);
    try std.testing.expect(!fp.has_inode);
}

test "fromDbWithInode" {
    const fp = fromDbWithInode(1234567890, 5000, 12345);
    try std.testing.expectEqual(@as(i64, 1234567890), fp.mtime_ns);
    try std.testing.expectEqual(@as(i64, 5000), fp.size);
    try std.testing.expectEqual(@as(u64, 12345), fp.inode);
    try std.testing.expect(fp.has_inode);
}
