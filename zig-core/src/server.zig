//! HTTP transport for the sidecar (TASK-355.3 Part D): a single-threaded
//! accept loop binding 127.0.0.1 on an OS-assigned port, bearer-token auth,
//! and one route (`GET /api/library`).
//!
//! Single-threaded by design: `std.http.Server` handles one connection at a
//! time, and a local frontend's `fetch()` does not pipeline concurrent
//! requests — a thread pool would be YAGNI for this POC. `reuse_address` is
//! deliberately not set, so two sidecar instances cannot silently share a
//! port.
//!
//! CORS is intentionally not handled here. This endpoint's real caller (the
//! Tauri webview, once TASK-355.6 flips the frontend) needs it, but getting
//! the allowed origin right requires testing against that real webview —
//! guessing it here risks silently shipping a wrong value nothing would
//! catch until 355.6. None of this task's Acceptance Criteria require it.

const std = @import("std");
const runtime_file = @import("runtime_file.zig");
const library = @import("library.zig");
const sqlite = @import("sqlite.zig");

pub const Options = struct {
    db: *sqlite.Db,
    token: *const [runtime_file.token_hex_len]u8,
    /// Threaded from main.zig's `--sabotage` flag through to `library.respond`.
    /// Default false, so the real endpoint path is byte-for-byte unchanged.
    sabotage: bool = false,
};

/// Binds 127.0.0.1 on an OS-assigned port (AC#1). The caller reads back the
/// actual port via `net_server.socket.address.getPort()` and writes it to
/// the runtime file (`runtime_file.write`) before calling `serveForever`.
pub fn listen(io: std.Io) !std.Io.net.Server {
    const address = try std.Io.net.IpAddress.parse("127.0.0.1", 0);
    return address.listen(io, .{});
}

/// Blocks accepting connections until `stopping` is set. Closing the
/// listening socket out from under a thread blocked in `accept()` is
/// unsafe (the stdlib treats the resulting `EBADF` as an unconditional bug,
/// not a cancellation signal), so shutdown instead sets `stopping` and
/// makes a throwaway connection to itself to unblock the pending `accept()`
/// — see `TestServer.stop` in the test harness below.
pub fn serveForever(io: std.Io, net_server: *std.Io.net.Server, allocator: std.mem.Allocator, options: Options, stopping: *std.atomic.Value(bool)) !void {
    while (!stopping.load(.acquire)) {
        const stream = net_server.accept(io) catch |err| switch (err) {
            error.ConnectionAborted => continue,
            else => return err,
        };
        defer stream.close(io);
        if (stopping.load(.acquire)) return;
        serveConnection(io, stream, allocator, options) catch {};
    }
}

/// One request per connection: `receiveHead` is called once, a response is
/// sent with `keep_alive = false`, and the connection is closed by the
/// caller. `std.http.Server` supports multiple requests per connection, but
/// a single local frontend caller has no need for it — YAGNI.
fn serveConnection(io: std.Io, stream: std.Io.net.Stream, allocator: std.mem.Allocator, options: Options) !void {
    var recv_buf: [8 * 1024]u8 = undefined;
    var send_buf: [8 * 1024]u8 = undefined;
    var conn_reader = stream.reader(io, &recv_buf);
    var conn_writer = stream.writer(io, &send_buf);
    var http_server = std.http.Server.init(&conn_reader.interface, &conn_writer.interface);

    // `receiveHead` returning an error (oversized/truncated/invalid head)
    // means there is no `Request` to respond on — the stdlib's own servers
    // just close the connection in this case, which `defer stream.close()`
    // in the caller already does (AC#6 malformed-request case).
    var request = http_server.receiveHead() catch return;
    handleRequest(&request, allocator, options) catch return;
}

fn handleRequest(request: *std.http.Server.Request, allocator: std.mem.Allocator, options: Options) !void {
    if (!isAuthorized(request, options.token)) {
        return respondError(request, .unauthorized, "unauthorized");
    }

    const target = request.head.target;
    const q_idx = std.mem.indexOfScalar(u8, target, '?');
    const path = if (q_idx) |i| target[0..i] else target;
    const raw_query = if (q_idx) |i| target[i + 1 ..] else "";

    if (!std.mem.eql(u8, path, "/api/library")) {
        return respondError(request, .not_found, "not found");
    }
    if (request.head.method != .GET) {
        return respondError(request, .method_not_allowed, "method not allowed");
    }

    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const arena_allocator = arena.allocator();

    const query = library.parseQuery(arena_allocator, raw_query) catch {
        return respondError(request, .bad_request, "invalid query parameters");
    };

    var send_buffer: [16 * 1024]u8 = undefined;
    var response = try request.respondStreaming(&send_buffer, .{
        .respond_options = .{
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "content-type", .value = "application/json" }},
        },
    });
    // A SQLite failure here happens after the 200 status line is already
    // queued — there is no way to downgrade to a 500 mid-stream. The
    // client sees a truncated body; that's an accepted consequence of
    // streaming (AC#5), not a bug to work around.
    try library.respondWithSabotage(arena_allocator, options.db, query, &response.writer, options.sabotage);
    try response.end();
}

/// `Request.iterateHeaders()` does not normalize header names, so matching
/// uses a case-insensitive compare; entries with `is_trailer` set are
/// ignored. The length check happens before the constant-time compare —
/// unavoidably non-constant-time, but only leaks the token's length, not
/// its content.
fn isAuthorized(request: *std.http.Server.Request, token: *const [runtime_file.token_hex_len]u8) bool {
    const prefix = "Bearer ";
    var it = request.iterateHeaders();
    while (it.next()) |header| {
        if (it.is_trailer) continue;
        if (!std.ascii.eqlIgnoreCase(header.name, "authorization")) continue;
        if (header.value.len != prefix.len + runtime_file.token_hex_len) return false;
        if (!std.mem.eql(u8, header.value[0..prefix.len], prefix)) return false;
        const provided: [runtime_file.token_hex_len]u8 = header.value[prefix.len..][0..runtime_file.token_hex_len].*;
        return std.crypto.timing_safe.eql([runtime_file.token_hex_len]u8, provided, token.*);
    }
    return false;
}

/// `shared.js` (the frontend's dormant HTTP client) reads `error.detail`,
/// so every error body uses this shape.
fn respondError(request: *std.http.Server.Request, status: std.http.Status, detail: []const u8) !void {
    var buf: [256]u8 = undefined;
    const body = try std.fmt.bufPrint(&buf, "{{\"detail\":\"{s}\"}}", .{detail});
    try request.respond(body, .{
        .status = status,
        .keep_alive = false,
        .extra_headers = &.{.{ .name = "content-type", .value = "application/json" }},
    });
}

const testing = std.testing;

fn createTestLibraryTable(db: *sqlite.Db) !void {
    try db.exec(
        \\CREATE TABLE library (
        \\  id INTEGER PRIMARY KEY, filepath TEXT NOT NULL, title TEXT, artist TEXT,
        \\  album TEXT, album_artist TEXT, track_number TEXT, track_total TEXT,
        \\  disc_number TEXT, disc_total TEXT, date TEXT, genre TEXT, duration REAL,
        \\  file_size INTEGER, file_mtime_ns INTEGER, file_ctime_ns INTEGER,
        \\  file_inode INTEGER, content_hash TEXT, added_date TEXT, last_played TEXT,
        \\  play_count INTEGER, missing INTEGER, last_seen_at INTEGER, source TEXT,
        \\  remote_id TEXT
        \\)
    );
}

const TestServer = struct {
    net_server: std.Io.net.Server,
    thread: std.Thread,
    stopping: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    fn start(db: *sqlite.Db, token: *const [runtime_file.token_hex_len]u8) !*TestServer {
        const self = try testing.allocator.create(TestServer);
        errdefer testing.allocator.destroy(self);
        self.* = .{ .net_server = try listen(testing.io), .thread = undefined };
        self.thread = try std.Thread.spawn(.{}, struct {
            fn run(ns: *std.Io.net.Server, opts: Options, stopping: *std.atomic.Value(bool)) void {
                serveForever(testing.io, ns, testing.allocator, opts, stopping) catch {};
            }
        }.run, .{ &self.net_server, Options{ .db = db, .token = token }, &self.stopping });
        return self;
    }

    // The server thread is parked in a blocking `accept()`. Closing the
    // listening socket out from under it is unsafe, so instead: flag the
    // loop to stop, then open (and immediately drop) a connection to wake
    // the pending `accept()` up so the loop can observe the flag.
    fn stop(self: *TestServer) void {
        self.stopping.store(true, .release);
        if (self.net_server.socket.address.connect(testing.io, .{ .mode = .stream })) |stream| {
            stream.close(testing.io);
        } else |_| {}
        self.thread.join();
        self.net_server.deinit(testing.io);
        testing.allocator.destroy(self);
    }
};

fn sendRequest(stream: std.Io.net.Stream, bytes: []const u8) !void {
    var conn_writer = stream.writer(testing.io, &.{});
    try conn_writer.interface.writeAll(bytes);
}

fn readResponse(stream: std.Io.net.Stream, buf: []u8) ![]u8 {
    var small_buf: [1024]u8 = undefined;
    var stream_reader = stream.reader(testing.io, &small_buf);
    const n = try stream_reader.interface.readSliceShort(buf);
    return buf[0..n];
}

test "unauthorized: missing Authorization header returns 401" {
    var db = try sqlite.Db.openForTestFixture(":memory:");
    defer db.close();
    try createTestLibraryTable(&db);

    const token = runtime_file.generateToken(testing.io);
    const server = try TestServer.start(&db, &token);
    defer server.stop();

    const stream = try server.net_server.socket.address.connect(testing.io, .{ .mode = .stream });
    defer stream.close(testing.io);
    try sendRequest(stream, "GET /api/library HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");

    var buf: [4096]u8 = undefined;
    const response = try readResponse(stream, &buf);
    try testing.expect(std.mem.startsWith(u8, response, "HTTP/1.1 401 "));
    try testing.expect(std.mem.indexOf(u8, response, "\"detail\":\"unauthorized\"") != null);
}

test "unauthorized: wrong bearer token returns 401" {
    var db = try sqlite.Db.openForTestFixture(":memory:");
    defer db.close();
    try createTestLibraryTable(&db);

    const token = runtime_file.generateToken(testing.io);
    const server = try TestServer.start(&db, &token);
    defer server.stop();

    const stream = try server.net_server.socket.address.connect(testing.io, .{ .mode = .stream });
    defer stream.close(testing.io);
    try sendRequest(stream, "GET /api/library HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer wrong-token-wrong-token-wrong-token-wrong-token\r\nConnection: close\r\n\r\n");

    var buf: [4096]u8 = undefined;
    const response = try readResponse(stream, &buf);
    try testing.expect(std.mem.startsWith(u8, response, "HTTP/1.1 401 "));
}

test "authorized: valid token returns 200 with a parseable JSON body" {
    var db = try sqlite.Db.openForTestFixture(":memory:");
    defer db.close();
    try createTestLibraryTable(&db);
    try db.exec("INSERT INTO library (id, filepath, title, missing) VALUES (1, '/a.mp3', 'A Song', 0)");

    const token = runtime_file.generateToken(testing.io);
    const server = try TestServer.start(&db, &token);
    defer server.stop();

    const stream = try server.net_server.socket.address.connect(testing.io, .{ .mode = .stream });
    defer stream.close(testing.io);
    var req_buf: [256]u8 = undefined;
    const req = try std.fmt.bufPrint(&req_buf, "GET /api/library HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {s}\r\nConnection: close\r\n\r\n", .{token});
    try sendRequest(stream, req);

    var buf: [8192]u8 = undefined;
    const response = try readResponse(stream, &buf);
    try testing.expect(std.mem.startsWith(u8, response, "HTTP/1.1 200 "));

    const body_start = std.mem.indexOf(u8, response, "\r\n\r\n").? + 4;
    // chunked transfer-encoding (AC#5's streaming consequence): strip the
    // hex chunk-length lines rather than parsing the body as raw JSON.
    var dechunked: std.ArrayList(u8) = .empty;
    defer dechunked.deinit(testing.allocator);
    var lines = std.mem.splitSequence(u8, response[body_start..], "\r\n");
    while (lines.next()) |line| {
        const len = std.fmt.parseInt(usize, line, 16) catch break;
        if (len == 0) break;
        const chunk = lines.next() orelse break;
        try dechunked.appendSlice(testing.allocator, chunk[0..@min(len, chunk.len)]);
    }

    const parsed = try std.json.parseFromSlice(std.json.Value, testing.allocator, dechunked.items, .{});
    defer parsed.deinit();
    try testing.expectEqual(@as(i64, 1), parsed.value.object.get("total").?.integer);
}

test "malformed request: garbage head closes the connection without a response" {
    var db = try sqlite.Db.openForTestFixture(":memory:");
    defer db.close();
    try createTestLibraryTable(&db);

    const token = runtime_file.generateToken(testing.io);
    const server = try TestServer.start(&db, &token);
    defer server.stop();

    const stream = try server.net_server.socket.address.connect(testing.io, .{ .mode = .stream });
    defer stream.close(testing.io);
    try sendRequest(stream, "this is not an HTTP request\r\n\r\n");

    var buf: [256]u8 = undefined;
    const response = try readResponse(stream, &buf);
    try testing.expectEqual(@as(usize, 0), response.len);
}

test "not found: unknown path returns 404" {
    var db = try sqlite.Db.openForTestFixture(":memory:");
    defer db.close();
    try createTestLibraryTable(&db);

    const token = runtime_file.generateToken(testing.io);
    const server = try TestServer.start(&db, &token);
    defer server.stop();

    const stream = try server.net_server.socket.address.connect(testing.io, .{ .mode = .stream });
    defer stream.close(testing.io);
    var req_buf: [256]u8 = undefined;
    const req = try std.fmt.bufPrint(&req_buf, "GET /nope HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {s}\r\nConnection: close\r\n\r\n", .{token});
    try sendRequest(stream, req);

    var buf: [4096]u8 = undefined;
    const response = try readResponse(stream, &buf);
    try testing.expect(std.mem.startsWith(u8, response, "HTTP/1.1 404 "));
}
