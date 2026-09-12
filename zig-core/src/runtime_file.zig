//! Bearer-token generation and the port/token file (TASK-355.3 AC#2).
//!
//! `write()` publishes the ephemeral port the server bound and a fresh
//! bearer token as JSON, `0600`, in a directory the caller controls (the
//! app data directory, in production — passed on the command line rather
//! than resolved here; see zig-core/README.md).

const std = @import("std");
const builtin = @import("builtin");

pub const token_bytes_len = 32;
/// Fixed at comptime so std.crypto.timing_safe.eql can take an array type
/// (it rejects slices) when the token is later compared in server.zig.
pub const token_hex_len = token_bytes_len * 2;

pub const file_name = "sidecar.json";

/// 256 bits of CSPRNG entropy, hex-encoded into a fixed array with no
/// allocation. A fresh token is generated on every call — a leaked token
/// from a previous run must stop working as soon as the sidecar restarts.
pub fn generateToken(io: std.Io) [token_hex_len]u8 {
    var raw: [token_bytes_len]u8 = undefined;
    std.Io.random(io, &raw);
    return std.fmt.bytesToHex(raw, .lower);
}

/// Writes `{"port":N,"token":"..."}` to `dir/sidecar.json` at 0600.
///
/// A stale file from a previous run is unlinked before creating a new one
/// with `O_EXCL`: `createFile`'s `permissions` is only honored when the file
/// is actually created, so simply truncating a pre-existing file would leave
/// whatever permissions (or symlink target) were already there in place —
/// including a file an attacker pre-planted at this path to defeat AC#2.
pub fn write(dir: std.Io.Dir, io: std.Io, port: u16, token: *const [token_hex_len]u8) !void {
    dir.deleteFile(io, file_name) catch |err| switch (err) {
        error.FileNotFound => {},
        else => return err,
    };

    const create_flags: std.Io.Dir.CreateFileOptions = if (builtin.os.tag == .windows)
        // `permissions` is a no-op on Windows; ACL hardening is out of scope
        // for this POC (see zig-core/README.md).
        .{ .truncate = true, .exclusive = true }
    else
        .{ .permissions = .fromMode(0o600), .truncate = true, .exclusive = true };

    const file = try dir.createFile(io, file_name, create_flags);
    defer file.close(io);

    var buf: [256]u8 = undefined;
    var fw = file.writer(io, &buf);
    try fw.interface.print("{{\"port\":{d},\"token\":\"{s}\"}}\n", .{ port, token.* });
    try fw.interface.flush();
}

pub fn remove(dir: std.Io.Dir, io: std.Io) void {
    dir.deleteFile(io, file_name) catch {};
}

const testing = std.testing;

test "write then read back port and token" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    const token = generateToken(testing.io);
    try write(tmp.dir, testing.io, 54321, &token);

    const contents = try tmp.dir.readFileAlloc(testing.io, file_name, testing.allocator, .limited(256));
    defer testing.allocator.free(contents);

    const Parsed = struct { port: u16, token: []const u8 };
    const parsed = try std.json.parseFromSlice(Parsed, testing.allocator, contents, .{});
    defer parsed.deinit();

    try testing.expectEqual(@as(u16, 54321), parsed.value.port);
    try testing.expectEqualStrings(&token, parsed.value.token);
}

test "the file is 0600, unix only" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    const token = generateToken(testing.io);
    try write(tmp.dir, testing.io, 1, &token);

    const stat = try tmp.dir.statFile(testing.io, file_name, .{});
    try testing.expectEqual(@as(std.posix.mode_t, 0o600), stat.permissions.toMode() & 0o777);
}

test "writing twice overwrites a stale file and keeps 0600" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;

    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();

    const first = generateToken(testing.io);
    try write(tmp.dir, testing.io, 1, &first);

    const second = generateToken(testing.io);
    try write(tmp.dir, testing.io, 2, &second);

    const stat = try tmp.dir.statFile(testing.io, file_name, .{});
    try testing.expectEqual(@as(std.posix.mode_t, 0o600), stat.permissions.toMode() & 0o777);

    const contents = try tmp.dir.readFileAlloc(testing.io, file_name, testing.allocator, .limited(256));
    defer testing.allocator.free(contents);
    const Parsed = struct { port: u16, token: []const u8 };
    const parsed = try std.json.parseFromSlice(Parsed, testing.allocator, contents, .{});
    defer parsed.deinit();
    try testing.expectEqual(@as(u16, 2), parsed.value.port);
}

test "remove is a no-op when the file does not exist" {
    var tmp = testing.tmpDir(.{});
    defer tmp.cleanup();
    remove(tmp.dir, testing.io);
}

test "two tokens are not equal" {
    const a = generateToken(testing.io);
    const b = generateToken(testing.io);
    try testing.expect(!std.mem.eql(u8, &a, &b));
}
