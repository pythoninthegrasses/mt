const std = @import("std");
const sqlite = @import("sqlite.zig");
const runtime_file = @import("runtime_file.zig");
const server = @import("server.zig");

const Args = struct {
    db_path: [:0]const u8,
    runtime_dir: []const u8,
};

fn parseArgs(argv: []const [:0]const u8) !Args {
    var db_path: ?[:0]const u8 = null;
    var runtime_dir: ?[]const u8 = null;

    var i: usize = 1;
    while (i < argv.len) : (i += 1) {
        if (std.mem.eql(u8, argv[i], "--db")) {
            i += 1;
            if (i >= argv.len) return error.MissingArgValue;
            db_path = argv[i];
        } else if (std.mem.eql(u8, argv[i], "--runtime-dir")) {
            i += 1;
            if (i >= argv.len) return error.MissingArgValue;
            runtime_dir = argv[i];
        } else {
            std.log.err("unrecognized argument: {s}", .{argv[i]});
            return error.UnrecognizedArg;
        }
    }

    return Args{
        .db_path = db_path orelse return error.MissingDbPath,
        .runtime_dir = runtime_dir orelse return error.MissingRuntimeDir,
    };
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const argv = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, argv);

    const args = parseArgs(argv) catch |err| {
        std.log.err("usage: mt-zig-core --db <path/to/mt.db> --runtime-dir <dir> ({s})", .{@errorName(err)});
        std.process.exit(1);
    };

    var db = sqlite.Db.openReadOnly(args.db_path) catch |err| {
        std.log.err("failed to open --db {s}: {s}", .{ args.db_path, @errorName(err) });
        std.process.exit(1);
    };
    defer db.close();

    var runtime_dir = std.fs.cwd().openDir(args.runtime_dir, .{}) catch |err| {
        std.log.err("failed to open --runtime-dir {s}: {s}", .{ args.runtime_dir, @errorName(err) });
        std.process.exit(1);
    };
    defer runtime_dir.close();

    var net_server = try server.listen();
    defer net_server.deinit();
    const port = net_server.listen_address.getPort();

    const token = runtime_file.generateToken();
    try runtime_file.write(runtime_dir, port, &token);
    defer runtime_file.remove(runtime_dir);

    std.log.info("mt-zig-core listening on 127.0.0.1:{d} (sqlite {s})", .{ port, sqlite.libVersion() });

    var stopping = std.atomic.Value(bool).init(false);
    try server.serveForever(&net_server, allocator, .{ .db = &db, .token = &token }, &stopping);
}

test "sanity" {
    try std.testing.expect(1 + 1 == 2);
}

test {
    _ = @import("sqlite.zig");
    _ = @import("strip_sort_prefix.zig");
    _ = @import("runtime_file.zig");
    _ = @import("library.zig");
    _ = @import("server.zig");
}
