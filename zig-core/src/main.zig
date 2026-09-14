const std = @import("std");
const sqlite = @import("sqlite.zig");
const runtime_file = @import("runtime_file.zig");
const library = @import("library.zig");
const server = @import("server.zig");

const Args = struct {
    db_path: [:0]const u8,
    runtime_dir: []const u8,
    /// Deliberately break one field's serialization, so the Rust side of the
    /// shadow-diff harness (TASK-355.5) can be shown to catch a divergence
    /// instead of merely being told it compares two implementations. No CI
    /// job passes this; it is inert without an explicit caller.
    sabotage: bool = false,
};

fn parseArgs(argv: []const [:0]const u8) !Args {
    var db_path: ?[:0]const u8 = null;
    var runtime_dir: ?[]const u8 = null;
    var sabotage = false;

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
        } else if (std.mem.eql(u8, argv[i], "--sabotage")) {
            sabotage = true;
        } else {
            std.log.err("unrecognized argument: {s}", .{argv[i]});
            return error.UnrecognizedArg;
        }
    }

    return Args{
        .db_path = db_path orelse return error.MissingDbPath,
        .runtime_dir = runtime_dir orelse return error.MissingRuntimeDir,
        .sabotage = sabotage,
    };
}

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const io = init.io;

    const argv = try init.minimal.args.toSlice(init.arena.allocator());

    const args = parseArgs(argv) catch |err| {
        std.log.err("usage: mt-zig-core --db <path/to/mt.db> --runtime-dir <dir> ({s})", .{@errorName(err)});
        std.process.exit(1);
    };

    var db = sqlite.Db.openReadOnly(args.db_path) catch |err| {
        std.log.err("failed to open --db {s}: {s}", .{ args.db_path, @errorName(err) });
        std.process.exit(1);
    };
    defer db.close();

    var runtime_dir = std.Io.Dir.cwd().openDir(io, args.runtime_dir, .{}) catch |err| {
        std.log.err("failed to open --runtime-dir {s}: {s}", .{ args.runtime_dir, @errorName(err) });
        std.process.exit(1);
    };
    defer runtime_dir.close(io);

    var net_server = try server.listen(io);
    defer net_server.deinit(io);
    const port = net_server.socket.address.getPort();

    const token = runtime_file.generateToken(io);
    try runtime_file.write(runtime_dir, io, port, &token);
    defer runtime_file.remove(runtime_dir, io);

    std.log.info("mt-zig-core listening on 127.0.0.1:{d} (sqlite {s})", .{ port, sqlite.libVersion() });

    if (args.sabotage) {
        std.log.warn("sabotage enabled: {s} will not match the Rust implementation", .{library.sabotage_field});
    }

    var stopping = std.atomic.Value(bool).init(false);
    try server.serveForever(io, &net_server, allocator, .{ .db = &db, .token = &token, .sabotage = args.sabotage }, &stopping);
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
