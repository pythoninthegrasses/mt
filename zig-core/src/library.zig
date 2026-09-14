//! Ports crates/mt-tauri/src/db/library.rs's WHERE/ORDER BY construction and
//! db/models.rs's Track field layout and row_to_track coercions, faithfully
//! enough for TASK-355.5 to diff this sidecar's JSON against the Rust
//! command's byte-for-byte. SQL condition order, ORDER BY expressions, and
//! JSON field order are copied from the Rust source, not rewritten.
//!
//! Ownership: functions here take a plain allocator and do not individually
//! free every escaping allocation (Query string fields, Where's bind
//! params). Callers — server.zig per-request, and this file's own tests —
//! are expected to use an arena and free everything in one `arena.deinit()`
//! at the end. Leaf functions whose only allocation is the single returned
//! buffer (orderByClause and friends) are the exception: they free their
//! own locals and are safe to call directly with `std.testing.allocator`.

const std = @import("std");
const sqlite = @import("sqlite.zig");

/// crates/mt-tauri/src/db/models.rs:320
pub const artist_sort_expr = "COALESCE(NULLIF(album_artist, ''), artist)";

/// crates/mt-tauri/src/db/models.rs:303-317,523-543. "date" and "year" both
/// parse to `.year` — 12 distinct input strings map to these 12 variants.
pub const SortColumn = enum {
    title,
    artist,
    album,
    added_date,
    play_count,
    duration,
    last_played,
    year,
    genre,
    disc_number,
    track_total,
    track_number,

    /// Unrecognized input falls back to `.added_date`, matching Rust's
    /// `FromStr` impl, which never actually returns `Err`.
    pub fn parse(s: []const u8) SortColumn {
        const eq = std.ascii.eqlIgnoreCase;
        if (eq(s, "title")) return .title;
        if (eq(s, "artist")) return .artist;
        if (eq(s, "album")) return .album;
        if (eq(s, "added_date")) return .added_date;
        if (eq(s, "play_count")) return .play_count;
        if (eq(s, "duration")) return .duration;
        if (eq(s, "last_played")) return .last_played;
        if (eq(s, "date") or eq(s, "year")) return .year;
        if (eq(s, "genre")) return .genre;
        if (eq(s, "disc_number")) return .disc_number;
        if (eq(s, "track_total")) return .track_total;
        if (eq(s, "track_number")) return .track_number;
        return .added_date;
    }

    /// models.rs:413-428
    pub fn columnExpr(self: SortColumn) []const u8 {
        return switch (self) {
            .title => "title",
            .artist => artist_sort_expr,
            .album => "album",
            .added_date => "added_date",
            .play_count => "play_count",
            .duration => "duration",
            .last_played => "last_played",
            .year => "date",
            .genre => "genre",
            .disc_number => "disc_number",
            .track_total => "track_total",
            .track_number => "track_number",
        };
    }

    /// models.rs:432-440
    pub fn isTextColumn(self: SortColumn) bool {
        return switch (self) {
            .title, .artist, .album, .genre => true,
            else => false,
        };
    }

    /// models.rs:465-473. Quotes are doubled and interpolated directly into
    /// the SQL text, not parameter-bound — carried over verbatim from Rust.
    fn textSortExpr(allocator: std.mem.Allocator, col: []const u8, ignore_words: ?[]const u8) ![]u8 {
        const words = ignore_words orelse return std.fmt.allocPrint(allocator, "{s} COLLATE NOCASE", .{col});
        const escaped = try escapeSingleQuotes(allocator, words);
        defer allocator.free(escaped);
        return std.fmt.allocPrint(allocator, "strip_sort_prefix({s}, '{s}') COLLATE NOCASE", .{ col, escaped });
    }

    /// models.rs:478-484
    pub fn orderByExpr(self: SortColumn, allocator: std.mem.Allocator, ignore_words: ?[]const u8) ![]u8 {
        if (self.isTextColumn()) return textSortExpr(allocator, self.columnExpr(), ignore_words);
        return allocator.dupe(u8, self.columnExpr());
    }

    /// models.rs:507-520. Always prefixed with ", "; secondaries are
    /// hardcoded ASC regardless of the primary sort order. Artist's
    /// secondary is album only (no artist); Album's secondary is artist
    /// only (no album) — asymmetric on purpose, not a bug to "fix".
    pub fn secondaryOrderByExpr(self: SortColumn, allocator: std.mem.Allocator, ignore_words: ?[]const u8) ![]u8 {
        const album_expr = try textSortExpr(allocator, "album", ignore_words);
        defer allocator.free(album_expr);
        const artist_expr = try textSortExpr(allocator, artist_sort_expr, ignore_words);
        defer allocator.free(artist_expr);
        const disc = "CAST(disc_number AS INTEGER) ASC";
        const track = "CAST(track_number AS INTEGER) ASC";

        return switch (self) {
            .artist => std.fmt.allocPrint(allocator, ", {s} ASC, {s}, {s}", .{ album_expr, disc, track }),
            .album => std.fmt.allocPrint(allocator, ", {s} ASC, {s}, {s}", .{ artist_expr, disc, track }),
            .disc_number => std.fmt.allocPrint(allocator, ", {s}", .{track}),
            .track_number => std.fmt.allocPrint(allocator, ", {s}", .{disc}),
            else => std.fmt.allocPrint(allocator, ", {s} ASC, {s} ASC, {s}, {s}", .{ artist_expr, album_expr, disc, track }),
        };
    }
};

fn escapeSingleQuotes(allocator: std.mem.Allocator, s: []const u8) ![]u8 {
    const n = std.mem.replacementSize(u8, s, "'", "''");
    const out = try allocator.alloc(u8, n);
    _ = std.mem.replace(u8, s, "'", "''", out);
    return out;
}

pub const SortOrder = enum {
    asc,
    desc,

    /// Exact-lowercase "asc" only; everything else (including absent) is
    /// desc — commands.rs:69-73.
    pub fn parse(s: ?[]const u8) SortOrder {
        const value = s orelse return .desc;
        return if (std.mem.eql(u8, value, "asc")) .asc else .desc;
    }

    pub fn asSql(self: SortOrder) []const u8 {
        return switch (self) {
            .asc => "ASC",
            .desc => "DESC",
        };
    }
};

/// Full ORDER BY clause (without the "ORDER BY " keyword).
pub fn orderByClause(allocator: std.mem.Allocator, sort_by: SortColumn, sort_order: SortOrder, ignore_words: ?[]const u8) ![]u8 {
    const primary = try sort_by.orderByExpr(allocator, ignore_words);
    defer allocator.free(primary);
    const secondary = try sort_by.secondaryOrderByExpr(allocator, ignore_words);
    defer allocator.free(secondary);
    return std.fmt.allocPrint(allocator, "{s} {s}{s}", .{ primary, sort_order.asSql(), secondary });
}

pub const BindValue = union(enum) {
    text: []const u8,
    int: i64,
};

/// crates/mt-tauri/src/db/library.rs `LibraryQuery`. `genre`, `year_from`,
/// `year_to` are never populated by `library_get_all` (it hardcodes them
/// `None`) but are kept here so the WHERE-condition ordering can't silently
/// drift from the Rust source if a future endpoint exposes them.
pub const Query = struct {
    search: ?[]const u8 = null,
    artist: ?[]const u8 = null,
    album: ?[]const u8 = null,
    genre: ?[]const u8 = null,
    year_from: ?i64 = null,
    year_to: ?i64 = null,
    source_filter: ?[]const u8 = null,
    sort_by: SortColumn = .added_date,
    sort_order: SortOrder = .desc,
    limit: i64 = 100,
    offset: i64 = 0,
    ignore_words: ?[]const u8 = null,
};

pub const ParseError = error{InvalidInteger} || std.mem.Allocator.Error;

/// Decodes an HTTP query string (the part after `?`) into a `Query`.
/// Unrecognized keys are ignored. `limit`/`offset` that fail to parse as
/// integers return `error.InvalidInteger` — the caller (server.zig) turns
/// that into a 400.
pub fn parseQuery(allocator: std.mem.Allocator, raw_query: []const u8) ParseError!Query {
    var q = Query{};
    var it = std.mem.splitScalar(u8, raw_query, '&');
    while (it.next()) |pair| {
        if (pair.len == 0) continue;
        const eq_idx = std.mem.indexOfScalar(u8, pair, '=');
        const raw_key = if (eq_idx) |i| pair[0..i] else pair;
        const raw_value = if (eq_idx) |i| pair[i + 1 ..] else "";
        const key = try decodeFormComponent(allocator, raw_key);
        const value = try decodeFormComponent(allocator, raw_value);

        if (std.mem.eql(u8, key, "search")) {
            q.search = value;
        } else if (std.mem.eql(u8, key, "artist")) {
            q.artist = value;
        } else if (std.mem.eql(u8, key, "album")) {
            q.album = value;
        } else if (std.mem.eql(u8, key, "source_filter")) {
            q.source_filter = value;
        } else if (std.mem.eql(u8, key, "ignore_words")) {
            q.ignore_words = value;
        } else if (std.mem.eql(u8, key, "sort_by")) {
            q.sort_by = SortColumn.parse(value);
        } else if (std.mem.eql(u8, key, "sort_order")) {
            q.sort_order = SortOrder.parse(value);
        } else if (std.mem.eql(u8, key, "limit")) {
            q.limit = std.fmt.parseInt(i64, value, 10) catch return ParseError.InvalidInteger;
        } else if (std.mem.eql(u8, key, "offset")) {
            q.offset = std.fmt.parseInt(i64, value, 10) catch return ParseError.InvalidInteger;
        }
    }
    return q;
}

/// `application/x-www-form-urlencoded` decoding: '+' -> ' ', then '%XX' hex
/// decoding. `URLSearchParams` (the frontend's query-string encoder) emits
/// spaces as '+', which `std.Uri.percentDecodeInPlace` does not handle — a
/// malformed or truncated '%' escape is passed through literally rather
/// than erroring.
pub fn decodeFormComponent(allocator: std.mem.Allocator, raw: []const u8) ![]u8 {
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    var i: usize = 0;
    while (i < raw.len) {
        const c = raw[i];
        if (c == '+') {
            try out.append(allocator, ' ');
            i += 1;
        } else if (c == '%' and i + 2 < raw.len) {
            const hi = std.fmt.charToDigit(raw[i + 1], 16) catch {
                try out.append(allocator, c);
                i += 1;
                continue;
            };
            const lo = std.fmt.charToDigit(raw[i + 2], 16) catch {
                try out.append(allocator, c);
                i += 1;
                continue;
            };
            try out.append(allocator, (@as(u8, hi) << 4) | lo);
            i += 3;
        } else {
            try out.append(allocator, c);
            i += 1;
        }
    }
    return out.toOwnedSlice(allocator);
}

const Where = struct {
    clause: []u8,
    params: std.ArrayList(BindValue),
};

/// db/library.rs:78-130. Condition order matches the Rust source exactly;
/// `(missing = 0 OR missing IS NULL)` is always appended last, so the
/// clause is never actually empty for this endpoint (the Rust `is_empty()`
/// branch is dead here too).
fn buildWhere(allocator: std.mem.Allocator, q: Query) !Where {
    var conditions: std.ArrayList([]const u8) = .empty;
    var params: std.ArrayList(BindValue) = .empty;

    if (q.search) |search| {
        try conditions.append(allocator, "(title LIKE ? OR artist LIKE ? OR album LIKE ?)");
        const term = try std.fmt.allocPrint(allocator, "%{s}%", .{search});
        try params.append(allocator, .{ .text = term });
        try params.append(allocator, .{ .text = term });
        try params.append(allocator, .{ .text = term });
    }

    if (q.artist) |artist| {
        try conditions.append(allocator, "artist = ?");
        try params.append(allocator, .{ .text = artist });
    }

    if (q.album) |album| {
        try conditions.append(allocator, "album = ?");
        try params.append(allocator, .{ .text = album });
    }

    if (q.genre) |genre| {
        try conditions.append(allocator, "genre LIKE ?");
        const term = try std.fmt.allocPrint(allocator, "%{s}%", .{genre});
        try params.append(allocator, .{ .text = term });
    }

    if (q.year_from) |year_from| {
        try conditions.append(allocator, "CAST(date AS INTEGER) >= ?");
        try params.append(allocator, .{ .int = year_from });
    }

    if (q.year_to) |year_to| {
        try conditions.append(allocator, "CAST(date AS INTEGER) <= ?");
        try params.append(allocator, .{ .int = year_to });
    }

    if (q.source_filter) |source| {
        try conditions.append(allocator, "source = ?");
        try params.append(allocator, .{ .text = source });
    }

    try conditions.append(allocator, "(missing = 0 OR missing IS NULL)");

    var clause: std.ArrayList(u8) = .empty;
    try clause.appendSlice(allocator, "WHERE ");
    for (conditions.items, 0..) |cond, i| {
        if (i != 0) try clause.appendSlice(allocator, " AND ");
        try clause.appendSlice(allocator, cond);
    }

    return Where{ .clause = try clause.toOwnedSlice(allocator), .params = params };
}

fn bindParams(stmt: *sqlite.Stmt, params: []const BindValue) !void {
    for (params, 0..) |p, i| {
        const idx: c_int = @intCast(i + 1);
        switch (p) {
            .text => |t| try stmt.bindText(idx, t),
            .int => |v| try stmt.bindInt64(idx, v),
        }
    }
}

fn buildCountSql(allocator: std.mem.Allocator, clause: []const u8) ![]u8 {
    return std.fmt.allocPrint(allocator, "SELECT COUNT(*) FROM library {s}", .{clause});
}

/// db/library.rs:137-141. This order (not `Track`'s declaration order) is
/// irrelevant to the JSON output — `writeTrack` looks up by name-equivalent
/// index below, mirroring Rust's `row.get("name")` lookups — but is kept
/// verbatim since it's what the Rust source actually sends to SQLite.
const select_columns = "id, filepath, title, artist, album, album_artist, " ++
    "track_number, track_total, disc_number, disc_total, date, genre, " ++
    "duration, file_size, play_count, last_played, added_date, " ++
    "missing, last_seen_at, file_mtime_ns, file_ctime_ns, file_inode, content_hash, " ++
    "source, remote_id";

const col_id: c_int = 0;
const col_filepath: c_int = 1;
const col_title: c_int = 2;
const col_artist: c_int = 3;
const col_album: c_int = 4;
const col_album_artist: c_int = 5;
const col_track_number: c_int = 6;
const col_track_total: c_int = 7;
const col_disc_number: c_int = 8;
const col_disc_total: c_int = 9;
const col_date: c_int = 10;
const col_genre: c_int = 11;
const col_duration: c_int = 12;
const col_file_size: c_int = 13;
const col_play_count: c_int = 14;
const col_last_played: c_int = 15;
const col_added_date: c_int = 16;
const col_missing: c_int = 17;
const col_last_seen_at: c_int = 18;
const col_file_mtime_ns: c_int = 19;
const col_file_ctime_ns: c_int = 20;
const col_file_inode: c_int = 21;
const col_content_hash: c_int = 22;
const col_source: c_int = 23;
const col_remote_id: c_int = 24;

fn buildSelectSql(allocator: std.mem.Allocator, clause: []const u8, order_by: []const u8) ![]u8 {
    return std.fmt.allocPrint(allocator, "SELECT {s} FROM library {s} ORDER BY {s} LIMIT ? OFFSET ?", .{ select_columns, clause, order_by });
}

fn isTextOrNull(stmt: *sqlite.Stmt, col: c_int) bool {
    const t = stmt.columnType(col);
    return t == sqlite.SQLITE_TEXT or t == sqlite.SQLITE_NULL;
}

fn isIntOrNull(stmt: *sqlite.Stmt, col: c_int) bool {
    const t = stmt.columnType(col);
    return t == sqlite.SQLITE_INTEGER or t == sqlite.SQLITE_NULL;
}

/// Mirrors rusqlite's per-field `FromSql` strictness in `row_to_track`
/// (db/library.rs:15-45): `query_map(...).filter_map(|r| r.ok())` silently
/// drops any row where a column's storage class doesn't coerce to the
/// `Track` field's Rust type — e.g. a Python-era TEXT column that actually
/// holds INTEGER data. `total` (a separate `COUNT(*)`) still counts a
/// dropped row, so `tracks.len()` can legitimately be less than `total`.
/// `file_ctime_ns`, `source`, and `remote_id` use `.unwrap_or(...)` in Rust
/// and never cause a drop, so they're intentionally excluded here.
fn rowIsMappable(stmt: *sqlite.Stmt) bool {
    if (stmt.columnType(col_id) != sqlite.SQLITE_INTEGER) return false;
    if (stmt.columnType(col_filepath) != sqlite.SQLITE_TEXT) return false;

    const text_or_null_cols = [_]c_int{
        col_title,        col_artist,      col_album,       col_album_artist,
        col_track_number, col_track_total, col_disc_number, col_disc_total,
        col_date,         col_genre,       col_added_date,  col_last_played,
        col_content_hash,
    };
    for (text_or_null_cols) |c| {
        if (!isTextOrNull(stmt, c)) return false;
    }

    const int_or_null_cols = [_]c_int{
        col_file_size,     col_play_count, col_missing,
        col_file_mtime_ns, col_file_inode, col_last_seen_at,
    };
    for (int_or_null_cols) |c| {
        if (!isIntOrNull(stmt, c)) return false;
    }

    const duration_type = stmt.columnType(col_duration);
    if (duration_type != sqlite.SQLITE_FLOAT and duration_type != sqlite.SQLITE_INTEGER and duration_type != sqlite.SQLITE_NULL) return false;

    return true;
}

fn optInt64(stmt: *sqlite.Stmt, col: c_int) ?i64 {
    return if (stmt.columnIsNull(col)) null else stmt.columnInt64(col);
}

/// `file_ctime_ns`'s lenient `.unwrap_or(None)` in Rust: any storage class
/// other than INTEGER (or NULL) resolves to `null` rather than dropping
/// the row.
fn optInt64Lenient(stmt: *sqlite.Stmt, col: c_int) ?i64 {
    if (stmt.columnType(col) != sqlite.SQLITE_INTEGER) return null;
    return stmt.columnInt64(col);
}

/// `remote_id`'s lenient `.unwrap_or(None)`.
fn optTextLenient(stmt: *sqlite.Stmt, col: c_int) ?[]const u8 {
    if (stmt.columnType(col) != sqlite.SQLITE_TEXT) return null;
    return stmt.columnText(col);
}

/// `source`'s `.unwrap_or_else(|_| "local".to_string())`.
fn textOrDefault(stmt: *sqlite.Stmt, col: c_int, default: []const u8) []const u8 {
    if (stmt.columnType(col) != sqlite.SQLITE_TEXT) return default;
    return stmt.columnText(col) orelse default;
}

/// `std.json.Stringify.write(f64)` renders a whole-number float without a
/// decimal point (`250` for `250.0`), unlike serde_json/ryu on the Rust
/// side (`250.0`). Appends `.0` when the default formatting produced no
/// `.`/`e`/`E`, so the two sides stay byte-identical.
fn writeF64(json: *std.json.Stringify, value: f64) !void {
    var buf: [64]u8 = undefined;
    const text = try std.fmt.bufPrint(&buf, "{}", .{value});
    if (std.mem.indexOfAny(u8, text, ".eE") != null) {
        try json.print("{s}", .{text});
    } else {
        try json.print("{s}.0", .{text});
    }
}

/// Which field `--sabotage` (main.zig) breaks. Named rather than hardcoded at
/// the use site so the harness's log and the sabotage agree on what diverged.
pub const sabotage_field = "genre";

/// Writes one track object in `Track`'s declaration order
/// (db/models.rs:13-41) — not `select_columns`' order.
fn writeTrack(json: *std.json.Stringify, stmt: *sqlite.Stmt, sabotage: bool) !void {
    try json.beginObject();

    try json.objectField("id");
    try json.write(stmt.columnInt64(col_id));

    try json.objectField("filepath");
    try json.write(stmt.columnText(col_filepath) orelse "");

    try json.objectField("title");
    try json.write(stmt.columnText(col_title));

    try json.objectField("artist");
    try json.write(stmt.columnText(col_artist));

    try json.objectField("album");
    try json.write(stmt.columnText(col_album));

    try json.objectField("album_artist");
    try json.write(stmt.columnText(col_album_artist));

    try json.objectField("track_number");
    try json.write(stmt.columnText(col_track_number));

    try json.objectField("track_total");
    try json.write(stmt.columnText(col_track_total));

    try json.objectField("disc_number");
    try json.write(stmt.columnText(col_disc_number));

    try json.objectField("disc_total");
    try json.write(stmt.columnText(col_disc_total));

    try json.objectField("date");
    try json.write(stmt.columnText(col_date));

    try json.objectField(sabotage_field);
    if (sabotage) {
        // One value, one field: enough for the harness to prove it can localize
        // a wrong value, not just notice the two documents differ.
        try json.write("SABOTAGED");
    } else {
        try json.write(stmt.columnText(col_genre));
    }

    try json.objectField("duration");
    if (stmt.columnIsNull(col_duration)) {
        try json.write(null);
    } else {
        try writeF64(json, stmt.columnDouble(col_duration));
    }

    try json.objectField("file_size");
    try json.write(optInt64(stmt, col_file_size) orelse 0);

    try json.objectField("file_mtime_ns");
    try json.write(optInt64(stmt, col_file_mtime_ns));

    try json.objectField("file_ctime_ns");
    try json.write(optInt64Lenient(stmt, col_file_ctime_ns));

    try json.objectField("file_inode");
    try json.write(optInt64(stmt, col_file_inode));

    try json.objectField("content_hash");
    try json.write(stmt.columnText(col_content_hash));

    try json.objectField("added_date");
    try json.write(stmt.columnText(col_added_date));

    try json.objectField("last_played");
    try json.write(stmt.columnText(col_last_played));

    try json.objectField("play_count");
    try json.write(optInt64(stmt, col_play_count) orelse 0);

    try json.objectField("missing");
    try json.write((optInt64(stmt, col_missing) orelse 0) != 0);

    try json.objectField("last_seen_at");
    try json.write(optInt64(stmt, col_last_seen_at));

    try json.objectField("source");
    try json.write(textOrDefault(stmt, col_source, "local"));

    try json.objectField("remote_id");
    try json.write(optTextLenient(stmt, col_remote_id));

    try json.endObject();
}

/// Streams `{"tracks":[...],"total":N,"limit":N,"offset":N}` directly to
/// `writer` — nothing is materialized in memory first (TASK-355.3 AC#5).
/// `total` is queried before streaming starts, so it can be emitted last
/// without buffering rows to count them.
pub fn respond(allocator: std.mem.Allocator, db: *sqlite.Db, query: Query, writer: *std.Io.Writer) !void {
    try respondWithSabotage(allocator, db, query, writer, false);
}

/// `respond` with the sabotage switch the `--sabotage` CLI flag reaches; the
/// endpoint itself always calls `respond`, so production behaviour is
/// untouched. Tests call this directly to cover the sabotaged path without a
/// second process.
pub fn respondWithSabotage(allocator: std.mem.Allocator, db: *sqlite.Db, query: Query, writer: *std.Io.Writer, sabotage: bool) !void {
    const where = try buildWhere(allocator, query);

    const count_sql = try buildCountSql(allocator, where.clause);
    var total: i64 = 0;
    {
        var stmt = try db.prepare(count_sql);
        defer stmt.finalize();
        try bindParams(&stmt, where.params.items);
        if (!try stmt.step()) return error.Sqlite;
        total = stmt.columnInt64(0);
    }

    const order_by = try orderByClause(allocator, query.sort_by, query.sort_order, query.ignore_words);
    const select_sql = try buildSelectSql(allocator, where.clause, order_by);

    var json: std.json.Stringify = .{ .writer = writer, .options = .{} };
    try json.beginObject();
    try json.objectField("tracks");
    try json.beginArray();
    {
        var stmt = try db.prepare(select_sql);
        defer stmt.finalize();
        try bindParams(&stmt, where.params.items);
        const limit_idx: c_int = @intCast(where.params.items.len + 1);
        const offset_idx: c_int = @intCast(where.params.items.len + 2);
        try stmt.bindInt64(limit_idx, query.limit);
        try stmt.bindInt64(offset_idx, query.offset);

        while (try stmt.step()) {
            if (!rowIsMappable(&stmt)) continue;
            try writeTrack(&json, &stmt, sabotage);
        }
    }
    try json.endArray();

    try json.objectField("total");
    try json.write(total);
    try json.objectField("limit");
    try json.write(query.limit);
    try json.objectField("offset");
    try json.write(query.offset);
    try json.endObject();
}

const testing = std.testing;

test "SortColumn.parse: recognized names" {
    try testing.expectEqual(SortColumn.title, SortColumn.parse("title"));
    try testing.expectEqual(SortColumn.title, SortColumn.parse("TITLE"));
    try testing.expectEqual(SortColumn.artist, SortColumn.parse("artist"));
    try testing.expectEqual(SortColumn.album, SortColumn.parse("album"));
    try testing.expectEqual(SortColumn.added_date, SortColumn.parse("added_date"));
    try testing.expectEqual(SortColumn.play_count, SortColumn.parse("play_count"));
    try testing.expectEqual(SortColumn.duration, SortColumn.parse("duration"));
    try testing.expectEqual(SortColumn.last_played, SortColumn.parse("last_played"));
    try testing.expectEqual(SortColumn.year, SortColumn.parse("date"));
    try testing.expectEqual(SortColumn.year, SortColumn.parse("year"));
    try testing.expectEqual(SortColumn.genre, SortColumn.parse("genre"));
    try testing.expectEqual(SortColumn.disc_number, SortColumn.parse("disc_number"));
    try testing.expectEqual(SortColumn.track_total, SortColumn.parse("track_total"));
    try testing.expectEqual(SortColumn.track_number, SortColumn.parse("track_number"));
}

test "SortColumn.parse: unrecognized input falls back to added_date" {
    try testing.expectEqual(SortColumn.added_date, SortColumn.parse("bogus"));
    try testing.expectEqual(SortColumn.added_date, SortColumn.parse(""));
}

test "SortOrder.parse: only exact-lowercase asc is ascending" {
    try testing.expectEqual(SortOrder.asc, SortOrder.parse("asc"));
    try testing.expectEqual(SortOrder.desc, SortOrder.parse("ASC"));
    try testing.expectEqual(SortOrder.desc, SortOrder.parse("desc"));
    try testing.expectEqual(SortOrder.desc, SortOrder.parse(null));
}

test "orderByClause: non-text column, no ignore_words" {
    const result = try orderByClause(testing.allocator, .added_date, .desc, null);
    defer testing.allocator.free(result);
    try testing.expectEqualStrings(
        "added_date DESC, " ++ artist_sort_expr ++ " COLLATE NOCASE ASC, album COLLATE NOCASE ASC, CAST(disc_number AS INTEGER) ASC, CAST(track_number AS INTEGER) ASC",
        result,
    );
}

test "orderByClause: text column (title) with ignore_words escaping" {
    const result = try orderByClause(testing.allocator, .title, .asc, "The O'Brien");
    defer testing.allocator.free(result);
    try testing.expectEqualStrings(
        "strip_sort_prefix(title, 'The O''Brien') COLLATE NOCASE ASC, " ++
            "strip_sort_prefix(" ++ artist_sort_expr ++ ", 'The O''Brien') COLLATE NOCASE ASC, " ++
            "strip_sort_prefix(album, 'The O''Brien') COLLATE NOCASE ASC, CAST(disc_number AS INTEGER) ASC, CAST(track_number AS INTEGER) ASC",
        result,
    );
}

test "orderByClause: artist secondary is album only" {
    const result = try orderByClause(testing.allocator, .artist, .desc, null);
    defer testing.allocator.free(result);
    try testing.expectEqualStrings(
        artist_sort_expr ++ " COLLATE NOCASE DESC, album COLLATE NOCASE ASC, CAST(disc_number AS INTEGER) ASC, CAST(track_number AS INTEGER) ASC",
        result,
    );
}

test "orderByClause: album secondary is artist only" {
    const result = try orderByClause(testing.allocator, .album, .desc, null);
    defer testing.allocator.free(result);
    try testing.expectEqualStrings(
        "album COLLATE NOCASE DESC, " ++ artist_sort_expr ++ " COLLATE NOCASE ASC, CAST(disc_number AS INTEGER) ASC, CAST(track_number AS INTEGER) ASC",
        result,
    );
}

test "orderByClause: disc_number and track_number have single-column secondaries" {
    const disc = try orderByClause(testing.allocator, .disc_number, .asc, null);
    defer testing.allocator.free(disc);
    try testing.expectEqualStrings("disc_number ASC, CAST(track_number AS INTEGER) ASC", disc);

    const track = try orderByClause(testing.allocator, .track_number, .asc, null);
    defer testing.allocator.free(track);
    try testing.expectEqualStrings("track_number ASC, CAST(disc_number AS INTEGER) ASC", track);
}

test "decodeFormComponent: plus becomes space, percent-hex decodes" {
    const result = try decodeFormComponent(testing.allocator, "The+Beatles%20%26+Wings");
    defer testing.allocator.free(result);
    try testing.expectEqualStrings("The Beatles & Wings", result);
}

test "decodeFormComponent: truncated percent escape passes through literally" {
    const result = try decodeFormComponent(testing.allocator, "100%");
    defer testing.allocator.free(result);
    try testing.expectEqualStrings("100%", result);
}

test "parseQuery: defaults with an empty query string" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const q = try parseQuery(arena.allocator(), "");
    try testing.expectEqual(@as(i64, 100), q.limit);
    try testing.expectEqual(@as(i64, 0), q.offset);
    try testing.expectEqual(SortColumn.added_date, q.sort_by);
    try testing.expectEqual(SortOrder.desc, q.sort_order);
    try testing.expect(q.search == null);
}

test "parseQuery: decodes all recognized fields" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const q = try parseQuery(arena.allocator(), "search=foo+bar&artist=Queen&album=A+Night&sort_by=title&sort_order=asc&limit=25&offset=50&ignore_words=The&source_filter=local");
    try testing.expectEqualStrings("foo bar", q.search.?);
    try testing.expectEqualStrings("Queen", q.artist.?);
    try testing.expectEqualStrings("A Night", q.album.?);
    try testing.expectEqual(SortColumn.title, q.sort_by);
    try testing.expectEqual(SortOrder.asc, q.sort_order);
    try testing.expectEqual(@as(i64, 25), q.limit);
    try testing.expectEqual(@as(i64, 50), q.offset);
    try testing.expectEqualStrings("The", q.ignore_words.?);
    try testing.expectEqualStrings("local", q.source_filter.?);
}

test "parseQuery: unparseable limit is an error" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    try testing.expectError(ParseError.InvalidInteger, parseQuery(arena.allocator(), "limit=not-a-number"));
}

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

test "respond: streams tracks, total, limit, offset for a clean row" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var db = try sqlite.Db.openForTestFixture(":memory:");
    defer db.close();
    try createTestLibraryTable(&db);
    try db.exec(
        \\INSERT INTO library (id, filepath, title, artist, album, duration, file_size, play_count, missing, source)
        \\VALUES (1, '/music/a.mp3', 'A Song', 'An Artist', 'An Album', 250.0, 1000, 3, 0, 'local')
    );

    var out = std.Io.Writer.Allocating.init(allocator);
    const db_ptr = &db;
    try respond(allocator, db_ptr, .{}, &out.writer);

    const body = out.writer.buffered();
    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, body, .{});
    const root = parsed.value.object;

    try testing.expectEqual(@as(i64, 1), root.get("total").?.integer);
    try testing.expectEqual(@as(i64, 100), root.get("limit").?.integer);
    try testing.expectEqual(@as(i64, 0), root.get("offset").?.integer);

    const tracks = root.get("tracks").?.array;
    try testing.expectEqual(@as(usize, 1), tracks.items.len);
    const track = tracks.items[0].object;
    try testing.expectEqual(@as(i64, 1), track.get("id").?.integer);
    try testing.expectEqualStrings("/music/a.mp3", track.get("filepath").?.string);
    try testing.expectEqualStrings("A Song", track.get("title").?.string);
    try testing.expectEqual(@as(f64, 250.0), track.get("duration").?.float);
    try testing.expect(track.get("missing").? == .bool);
    try testing.expectEqual(false, track.get("missing").?.bool);
    try testing.expect(track.get("remote_id").? == .null);
    try testing.expectEqualStrings("local", track.get("source").?.string);
}

test "respond: duration renders with a trailing .0 for whole numbers" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var db = try sqlite.Db.openForTestFixture(":memory:");
    defer db.close();
    try createTestLibraryTable(&db);
    try db.exec(
        \\INSERT INTO library (id, filepath, duration, missing) VALUES (1, '/a.mp3', 250.0, 0)
    );

    var out = std.Io.Writer.Allocating.init(allocator);
    const db_ptr = &db;
    try respond(allocator, db_ptr, .{}, &out.writer);

    try testing.expect(std.mem.indexOf(u8, out.writer.buffered(), "\"duration\":250.0") != null);
}

test "respond: a row with a type-mismatched text column is dropped but still counted" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var db = try sqlite.Db.openForTestFixture(":memory:");
    defer db.close();
    try createTestLibraryTable(&db);
    // A clean row, then a row whose `file_size` holds non-numeric text.
    // SQLite's INTEGER-affinity conversion only coerces text that looks
    // like a number, so this genuinely lands as SQLITE_TEXT storage —
    // unlike `title` (TEXT affinity), which would silently stringify an
    // inserted integer rather than reproducing a real mismatch.
    try db.exec(
        \\INSERT INTO library (id, filepath, title, missing) VALUES (1, '/a.mp3', 'Fine', 0);
        \\INSERT INTO library (id, filepath, title, file_size, missing) VALUES (2, '/b.mp3', 'Also fine', 'not-a-number', 0);
    );

    var out = std.Io.Writer.Allocating.init(allocator);
    const db_ptr = &db;
    try respond(allocator, db_ptr, .{}, &out.writer);

    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, out.writer.buffered(), .{});
    const root = parsed.value.object;
    try testing.expectEqual(@as(i64, 2), root.get("total").?.integer);
    try testing.expectEqual(@as(usize, 1), root.get("tracks").?.array.items.len);
}

test "respond: search filters via LIKE on title/artist/album" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var db = try sqlite.Db.openForTestFixture(":memory:");
    defer db.close();
    try createTestLibraryTable(&db);
    try db.exec(
        \\INSERT INTO library (id, filepath, title, missing) VALUES (1, '/a.mp3', 'Match Me', 0);
        \\INSERT INTO library (id, filepath, title, missing) VALUES (2, '/b.mp3', 'Nope', 0);
    );

    var out = std.Io.Writer.Allocating.init(allocator);
    const db_ptr = &db;
    try respond(allocator, db_ptr, .{ .search = "Match" }, &out.writer);

    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, out.writer.buffered(), .{});
    const root = parsed.value.object;
    try testing.expectEqual(@as(i64, 1), root.get("total").?.integer);
}

test "respondWithSabotage: changes one field and leaves the rest alone" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var db = try sqlite.Db.openForTestFixture(":memory:");
    defer db.close();
    try createTestLibraryTable(&db);
    try db.exec(
        \\INSERT INTO library (id, filepath, title, genre, missing)
        \\VALUES (1, '/a.mp3', 'A Song', 'Jazz', 0)
    );

    var clean = std.Io.Writer.Allocating.init(allocator);
    try respond(allocator, &db, .{}, &clean.writer);
    try testing.expect(std.mem.indexOf(u8, clean.writer.buffered(), "\"genre\":\"Jazz\"") != null);

    var sabotaged = std.Io.Writer.Allocating.init(allocator);
    try respondWithSabotage(allocator, &db, .{}, &sabotaged.writer, true);
    const body = sabotaged.writer.buffered();
    try testing.expect(std.mem.indexOf(u8, body, "\"genre\":\"SABOTAGED\"") != null);
    // Only the one field moves; everything else the harness compares is byte
    // for byte what the honest path emits.
    try testing.expect(std.mem.indexOf(u8, body, "\"title\":\"A Song\"") != null);
    try testing.expect(std.mem.indexOf(u8, body, "\"total\":1") != null);
}

// AC#4: exercises `respond` against a real mt.db generated from the Rust
// schema (`task zig:fixture`), not a hand-built in-memory table. Skips
// rather than failing when the fixture is absent, mirroring the established
// pattern in crates/mt-tauri/src/db/compat_test.rs.
test "respond: total against the real mt_fixture.db matches a direct COUNT(*)" {
    var arena = std.heap.ArenaAllocator.init(testing.allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var db = sqlite.Db.openReadOnly("../tests/fixtures/mt_fixture.db") catch return error.SkipZigTest;
    defer db.close();

    var out = std.Io.Writer.Allocating.init(allocator);
    try respond(allocator, &db, .{}, &out.writer);

    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, out.writer.buffered(), .{});
    const total = parsed.value.object.get("total").?.integer;

    var count_stmt = try db.prepare("SELECT COUNT(*) FROM library WHERE (missing = 0 OR missing IS NULL)");
    defer count_stmt.finalize();
    try testing.expect(try count_stmt.step());
    try testing.expectEqual(count_stmt.columnInt64(0), total);
}
