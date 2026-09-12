//! Hand-written extern bindings for the SQLite C API, not @cImport — see
//! zig-core/README.md for why. Declares only the surface this sidecar
//! needs: read-only connection lifecycle, statement execution, and custom
//! scalar function registration.

const std = @import("std");

pub const sqlite3 = opaque {};
pub const sqlite3_stmt = opaque {};
pub const sqlite3_context = opaque {};
pub const sqlite3_value = opaque {};

pub const SQLITE_OK = 0;
pub const SQLITE_ROW = 100;
pub const SQLITE_DONE = 101;

pub const SQLITE_OPEN_READONLY: c_int = 0x00000001;
pub const SQLITE_OPEN_READWRITE: c_int = 0x00000002;
pub const SQLITE_OPEN_CREATE: c_int = 0x00000004;

pub const SQLITE_INTEGER = 1;
pub const SQLITE_FLOAT = 2;
pub const SQLITE_TEXT = 3;
pub const SQLITE_BLOB = 4;
pub const SQLITE_NULL = 5;

pub const SQLITE_UTF8: c_int = 1;
pub const SQLITE_DETERMINISTIC: c_int = 0x000000800;

// -1 as a pointer, the SQLite C API's sentinel for "copy this string now".
// It is never dereferenced, so it doesn't need to satisfy a real function
// pointer's alignment — `align(1)` tells Zig not to check for one (natural
// alignment would reject an all-ones address on targets like aarch64).
const SQLiteDestructor = ?*align(1) const fn (?*anyopaque) callconv(.c) void;
const SQLITE_TRANSIENT: SQLiteDestructor = @ptrFromInt(std.math.maxInt(usize));

extern fn sqlite3_open_v2(filename: [*:0]const u8, ppDb: *?*sqlite3, flags: c_int, zVfs: ?[*:0]const u8) c_int;
extern fn sqlite3_close_v2(db: ?*sqlite3) c_int;
extern fn sqlite3_busy_timeout(db: ?*sqlite3, ms: c_int) c_int;
extern fn sqlite3_errmsg(db: ?*sqlite3) [*:0]const u8;
extern fn sqlite3_libversion() [*:0]const u8;

extern fn sqlite3_prepare_v2(db: ?*sqlite3, zSql: [*]const u8, nByte: c_int, ppStmt: *?*sqlite3_stmt, pzTail: ?*?[*]const u8) c_int;
extern fn sqlite3_step(stmt: ?*sqlite3_stmt) c_int;
extern fn sqlite3_finalize(stmt: ?*sqlite3_stmt) c_int;
extern fn sqlite3_exec(db: ?*sqlite3, sql: [*:0]const u8, callback: ?*anyopaque, arg: ?*anyopaque, errmsg: ?*?[*:0]u8) c_int;

extern fn sqlite3_column_text(stmt: ?*sqlite3_stmt, iCol: c_int) ?[*:0]const u8;
extern fn sqlite3_column_bytes(stmt: ?*sqlite3_stmt, iCol: c_int) c_int;
extern fn sqlite3_column_type(stmt: ?*sqlite3_stmt, iCol: c_int) c_int;
extern fn sqlite3_column_count(stmt: ?*sqlite3_stmt) c_int;
extern fn sqlite3_column_int64(stmt: ?*sqlite3_stmt, iCol: c_int) i64;
extern fn sqlite3_column_double(stmt: ?*sqlite3_stmt, iCol: c_int) f64;
extern fn sqlite3_bind_text(stmt: ?*sqlite3_stmt, idx: c_int, text: [*]const u8, n: c_int, destructor: SQLiteDestructor) c_int;
extern fn sqlite3_bind_null(stmt: ?*sqlite3_stmt, idx: c_int) c_int;
extern fn sqlite3_bind_int64(stmt: ?*sqlite3_stmt, idx: c_int, value: i64) c_int;

pub const ScalarFunc = *const fn (ctx: ?*sqlite3_context, argc: c_int, argv: [*]?*sqlite3_value) callconv(.c) void;

extern fn sqlite3_create_function_v2(
    db: ?*sqlite3,
    zFunctionName: [*:0]const u8,
    nArg: c_int,
    eTextRep: c_int,
    pApp: ?*anyopaque,
    xFunc: ?ScalarFunc,
    xStep: ?*const fn (?*sqlite3_context, c_int, [*]?*sqlite3_value) callconv(.c) void,
    xFinal: ?*const fn (?*sqlite3_context) callconv(.c) void,
    xDestroy: ?*const fn (?*anyopaque) callconv(.c) void,
) c_int;

extern fn sqlite3_value_text(value: ?*sqlite3_value) ?[*:0]const u8;
extern fn sqlite3_value_bytes(value: ?*sqlite3_value) c_int;
extern fn sqlite3_value_type(value: ?*sqlite3_value) c_int;

extern fn sqlite3_result_text(ctx: ?*sqlite3_context, text: [*]const u8, n: c_int, destructor: SQLiteDestructor) void;
extern fn sqlite3_result_null(ctx: ?*sqlite3_context) void;
extern fn sqlite3_result_error(ctx: ?*sqlite3_context, msg: [*]const u8, n: c_int) void;

pub const Error = error{Sqlite};

fn check(db: ?*sqlite3, rc: c_int) Error!void {
    if (rc != SQLITE_OK) {
        std.log.err("sqlite error {d}: {s}", .{ rc, sqlite3_errmsg(db) });
        return Error.Sqlite;
    }
}

pub fn libVersion() [*:0]const u8 {
    return sqlite3_libversion();
}

/// A read-only SQLite connection, opened and configured with the same
/// PRAGMA sequence the Rust side uses (db/mod.rs `with_init`):
/// busy_timeout=5000, synchronous=NORMAL, foreign_keys=ON,
/// cache_size=-64000, then strip_sort_prefix is registered.
///
/// journal_mode=WAL, table creation, and migrations are write-path /
/// once-per-database concerns and are deliberately not ported — this
/// sidecar only reads.
pub const Db = struct {
    handle: ?*sqlite3,

    pub fn openReadOnly(path: [:0]const u8) Error!Db {
        var db = try openRaw(path, SQLITE_OPEN_READONLY);
        errdefer db.close();

        try check(db.handle, sqlite3_busy_timeout(db.handle, 5000));
        try db.exec("PRAGMA synchronous = NORMAL");
        try db.exec("PRAGMA foreign_keys = ON");
        try db.exec("PRAGMA cache_size = -64000");
        try db.registerScalarFunction("strip_sort_prefix", 2, stripSortPrefixUdf);

        return db;
    }

    /// A plain read-write in-memory connection with strip_sort_prefix
    /// registered but none of openReadOnly's PRAGMAs applied — used by
    /// tests to exercise the UDF through real SQL without touching disk.
    fn openMemoryForTest() Error!Db {
        var db = try openRaw(":memory:", SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);
        errdefer db.close();
        try db.registerScalarFunction("strip_sort_prefix", 2, stripSortPrefixUdf);
        return db;
    }

    /// A read-write connection to an on-disk file, creating it if absent —
    /// used by tests that need to build a throwaway fixture database (real
    /// `library` table, own rows) before exercising it through
    /// `openReadOnly`. Not used by the sidecar itself, which only reads.
    pub fn openForTestFixture(path: [:0]const u8) Error!Db {
        var db = try openRaw(path, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE);
        errdefer db.close();
        try db.registerScalarFunction("strip_sort_prefix", 2, stripSortPrefixUdf);
        return db;
    }

    fn openRaw(path: [:0]const u8, flags: c_int) Error!Db {
        var handle: ?*sqlite3 = null;
        const rc = sqlite3_open_v2(path.ptr, &handle, flags, null);
        if (rc != SQLITE_OK) {
            defer _ = sqlite3_close_v2(handle);
            try check(handle, rc);
        }
        return Db{ .handle = handle };
    }

    pub fn close(self: *Db) void {
        _ = sqlite3_close_v2(self.handle);
        self.handle = null;
    }

    pub fn exec(self: *Db, sql: [:0]const u8) Error!void {
        var errmsg: ?[*:0]u8 = null;
        const rc = sqlite3_exec(self.handle, sql.ptr, null, null, &errmsg);
        if (rc != SQLITE_OK) {
            if (errmsg) |m| std.log.err("sqlite exec error: {s}", .{m});
            return Error.Sqlite;
        }
    }

    pub fn registerScalarFunction(self: *Db, name: [:0]const u8, nArg: c_int, func: ScalarFunc) Error!void {
        try check(self.handle, sqlite3_create_function_v2(
            self.handle,
            name.ptr,
            nArg,
            SQLITE_UTF8 | SQLITE_DETERMINISTIC,
            null,
            func,
            null,
            null,
            null,
        ));
    }

    pub fn prepare(self: *Db, sql: []const u8) Error!Stmt {
        var stmt: ?*sqlite3_stmt = null;
        try check(self.handle, sqlite3_prepare_v2(self.handle, sql.ptr, @intCast(sql.len), &stmt, null));
        return Stmt{ .handle = stmt };
    }
};

pub const Stmt = struct {
    handle: ?*sqlite3_stmt,

    pub fn finalize(self: *Stmt) void {
        _ = sqlite3_finalize(self.handle);
        self.handle = null;
    }

    /// Returns true if a row is available; false at SQLITE_DONE.
    pub fn step(self: *Stmt) Error!bool {
        const rc = sqlite3_step(self.handle);
        return switch (rc) {
            SQLITE_ROW => true,
            SQLITE_DONE => false,
            else => Error.Sqlite,
        };
    }

    pub fn columnCount(self: *Stmt) c_int {
        return sqlite3_column_count(self.handle);
    }

    pub fn columnType(self: *Stmt, col: c_int) c_int {
        return sqlite3_column_type(self.handle, col);
    }

    pub fn columnIsNull(self: *Stmt, col: c_int) bool {
        return self.columnType(col) == SQLITE_NULL;
    }

    /// Text of column `col`. Caller must not free — owned by the statement,
    /// valid until the next step()/finalize() call.
    pub fn columnText(self: *Stmt, col: c_int) ?[]const u8 {
        const ptr = sqlite3_column_text(self.handle, col) orelse return null;
        const len: usize = @intCast(sqlite3_column_bytes(self.handle, col));
        return ptr[0..len];
    }

    pub fn columnInt64(self: *Stmt, col: c_int) i64 {
        return sqlite3_column_int64(self.handle, col);
    }

    pub fn columnDouble(self: *Stmt, col: c_int) f64 {
        return sqlite3_column_double(self.handle, col);
    }

    pub fn bindText(self: *Stmt, idx: c_int, text: []const u8) Error!void {
        try check(null, sqlite3_bind_text(self.handle, idx, text.ptr, @intCast(text.len), SQLITE_TRANSIENT));
    }

    pub fn bindNull(self: *Stmt, idx: c_int) Error!void {
        try check(null, sqlite3_bind_null(self.handle, idx));
    }

    pub fn bindInt64(self: *Stmt, idx: c_int, value: i64) Error!void {
        try check(null, sqlite3_bind_int64(self.handle, idx, value));
    }
};

/// Value of one SQL function argument, borrowed for the callback's duration.
pub fn valueText(value: ?*sqlite3_value) ?[]const u8 {
    if (sqlite3_value_type(value) == SQLITE_NULL) return null;
    const ptr = sqlite3_value_text(value) orelse return null;
    const len: usize = @intCast(sqlite3_value_bytes(value));
    return ptr[0..len];
}

pub fn resultText(ctx: ?*sqlite3_context, text: []const u8) void {
    sqlite3_result_text(ctx, text.ptr, @intCast(text.len), SQLITE_TRANSIENT);
}

pub fn resultNull(ctx: ?*sqlite3_context) void {
    sqlite3_result_null(ctx);
}

const strip_sort_prefix = @import("strip_sort_prefix.zig");

fn stripSortPrefixUdf(ctx: ?*sqlite3_context, argc: c_int, argv: [*]?*sqlite3_value) callconv(.c) void {
    std.debug.assert(argc == 2);
    const value = valueText(argv[0]) orelse {
        resultNull(ctx);
        return;
    };
    const prefixes = valueText(argv[1]) orelse {
        resultText(ctx, value);
        return;
    };
    resultText(ctx, strip_sort_prefix.stripSortPrefix(value, prefixes));
}

const testing = std.testing;

const GoldenCase = struct {
    value: ?[]const u8 = null,
    prefixes: ?[]const u8 = null,
    expected: ?[]const u8 = null,
    note: []const u8 = "",
};

test "strip_sort_prefix UDF matches the shared golden fixture" {
    const allocator = testing.allocator;
    const contents = try std.Io.Dir.cwd().readFileAlloc(testing.io, "../tests/fixtures/strip_sort_prefix.json", allocator, .limited(1 << 20));
    defer allocator.free(contents);

    const parsed = try std.json.parseFromSlice([]GoldenCase, allocator, contents, .{
        .ignore_unknown_fields = true,
    });
    defer parsed.deinit();

    var db = try Db.openMemoryForTest();
    defer db.close();

    var checked: usize = 0;
    for (parsed.value) |case| {
        var stmt = try db.prepare("SELECT strip_sort_prefix(?, ?)");
        defer stmt.finalize();

        if (case.value) |v| try stmt.bindText(1, v) else try stmt.bindNull(1);
        if (case.prefixes) |p| try stmt.bindText(2, p) else try stmt.bindNull(2);

        try testing.expect(try stmt.step());
        const result = stmt.columnText(0);

        if (case.expected) |expected| {
            try testing.expectEqualStrings(expected, result orelse return error.UnexpectedNull);
        } else {
            try testing.expect(result == null);
        }
        checked += 1;
    }
    try testing.expect(checked > 0);
}
