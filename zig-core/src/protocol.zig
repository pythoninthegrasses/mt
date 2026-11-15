//! Protocol v1 structural codec. Operation payload validation and authorization
//! are additional mandatory dispatch steps. No storage or process dependencies.
const std = @import("std");
const Value = std.json.Value;
pub const max_message_bytes = 1024 * 1024;
pub const ProtocolError = error{ Invalid, UnsupportedVersion, UnknownOperation, TooLarge, Truncated };

pub fn errorCode(err: ProtocolError) []const u8 {
    return switch (err) {
        error.Invalid, error.Truncated => "invalid_request",
        error.UnsupportedVersion => "unsupported_version",
        error.UnknownOperation => "unknown_operation",
        error.TooLarge => "too_large",
    };
}

fn check(ok: bool) ProtocolError!void {
    if (!ok) return error.Invalid;
}

fn get(value: Value, key: []const u8) Value {
    return if (value == .object) value.object.get(key) orelse .null else .null;
}

fn text(value: Value) []const u8 {
    return if (value == .string) value.string else "";
}

fn eq(value: Value, expected: []const u8) bool {
    return value == .string and std.mem.eql(u8, value.string, expected);
}

fn contains(items: []const []const u8, item: []const u8) bool {
    for (items) |candidate| {
        if (std.mem.eql(u8, candidate, item)) return true;
    }
    return false;
}

fn fields(value: Value, required: []const []const u8, optional: []const []const u8) ProtocolError!void {
    try check(value == .object);
    for (required) |key| try check(value.object.contains(key));
    for (value.object.keys()) |key| try check(contains(required, key) or contains(optional, key));
}

fn identity(value: Value) ProtocolError!void {
    try check(value == .string);
    try check(value.string.len > 0 and value.string.len <= 64);
    for (value.string) |c| try check(std.ascii.isAlphanumeric(c) or std.mem.indexOfScalar(u8, "._:-", c) != null);
}

fn decimal(value: Value, max: []const u8) ProtocolError!void {
    try check(value == .string);
    const s = value.string;
    try check(s.len > 0);
    for (s) |c| try check(std.ascii.isDigit(c));
    try check(s.len == 1 or s[0] != '0');
    try check(s.len < max.len or (s.len == max.len and std.mem.order(u8, s, max) != .gt));
}

fn number(value: Value) ?f64 {
    return switch (value) {
        .integer => |n| @floatFromInt(n),
        .float => |n| n,
        else => null,
    };
}

fn data(value: Value, depth: usize, key: []const u8) ProtocolError!void {
    try check(depth <= 32);
    if (contains(&.{ "revision", "sequence", "count", "timestamp_ms", "position_ms", "size_bytes" }, key))
        try decimal(value, "18446744073709551615");
    if (std.mem.eql(u8, key, "track_id")) {
        try decimal(value, "9223372036854775807");
        try check(!eq(value, "0"));
    }
    if (std.mem.eql(u8, key, "path")) {
        try check(value == .string);
        try check(std.mem.indexOfScalar(u8, value.string, 0) == null);
    }
    switch (value) {
        .integer, .float => try check(if (number(value)) |n| std.math.isFinite(n) and @abs(n) <= 9007199254740991 else false),
        .number_string => return error.Invalid,
        .string => |s| try check(std.unicode.utf8ValidateSlice(s)),
        .array => |items| for (items.items) |child| {
            try data(child, depth + 1, "");
        },
        .object => |map| {
            var it = map.iterator();
            while (it.next()) |entry| {
                try check(std.unicode.utf8ValidateSlice(entry.key_ptr.*));
                try data(entry.value_ptr.*, depth + 1, entry.key_ptr.*);
            }
        },
        else => {},
    }
}

pub fn errorStatus(code: []const u8) ?u16 {
    if (contains(&.{ "invalid_request", "unsupported_version" }, code)) return 400;
    if (std.mem.eql(u8, code, "unauthenticated")) return 401;
    if (std.mem.eql(u8, code, "forbidden")) return 403;
    if (contains(&.{ "unknown_operation", "not_found" }, code)) return 404;
    if (contains(&.{ "conflict", "busy", "cancelled" }, code)) return 409;
    if (std.mem.eql(u8, code, "too_large")) return 413;
    if (contains(&.{ "deadline_exceeded", "outcome_uncertain" }, code)) return 504;
    if (std.mem.eql(u8, code, "unavailable")) return 503;
    if (std.mem.eql(u8, code, "internal")) return 500;
    return null;
}

pub fn validate(value: Value, operations: []const []const u8) ProtocolError!void {
    const version = number(get(value, "version")) orelse return error.Invalid;
    try check(std.math.isFinite(version) and @floor(version) == version);
    if (version != 1) return error.UnsupportedVersion;
    try identity(get(value, "generation"));
    try identity(get(value, "operation"));
    if (!contains(operations, text(get(value, "operation")))) return error.UnknownOperation;
    const kind = get(value, "kind");
    if (eq(kind, "request")) {
        try fields(value, &.{ "version", "kind", "generation", "operation", "id", "payload", "deadline_ms" }, &.{});
        try identity(get(value, "id"));
        const deadline = number(get(value, "deadline_ms")) orelse return error.Invalid;
        try check(deadline >= 1 and deadline <= 300000 and @floor(deadline) == deadline);
        try check(get(value, "payload") == .object);
    } else if (eq(kind, "response")) {
        try fields(value, &.{ "version", "kind", "generation", "operation", "id" }, &.{ "result", "error" });
        try identity(get(value, "id"));
        try check(value.object.contains("result") != value.object.contains("error"));
        if (value.object.get("error")) |err| {
            try fields(err, &.{ "code", "message", "retryable" }, &.{"details"});
            try check(errorStatus(text(get(err, "code"))) != null);
            const message = get(err, "message");
            try check(message == .string and text(message).len <= 1024);
            const retryable = get(err, "retryable");
            try check(retryable == .bool);
            if (eq(get(err, "code"), "outcome_uncertain")) try check(!retryable.bool);
            if (err.object.get("details")) |details| try check(details == .object);
        }
    } else if (eq(kind, "event") or eq(kind, "observation")) {
        if (eq(kind, "event")) {
            try fields(value, &.{ "version", "kind", "generation", "operation", "sequence", "revision", "payload" }, &.{});
            try decimal(get(value, "revision"), "18446744073709551615");
        } else {
            try fields(value, &.{ "version", "kind", "generation", "operation", "sequence", "payload" }, &.{});
        }
        try decimal(get(value, "sequence"), "18446744073709551615");
        try check(!eq(get(value, "sequence"), "0"));
        try check(get(value, "payload") == .object);
    } else return error.Invalid;
    if (eq(get(value, "operation"), "control.cancel")) {
        if (eq(kind, "request")) {
            const payload = get(value, "payload");
            try fields(payload, &.{"target_id"}, &.{});
            try identity(get(payload, "target_id"));
        } else {
            try check(eq(kind, "response"));
            if (value.object.get("result")) |result| {
                try fields(result, &.{"state"}, &.{});
                try check(contains(&.{ "accepted", "already_finished", "not_found" }, text(get(result, "state"))));
            }
        }
    }
    try data(value, 0, "");
}

/// Owns parsed strings; deinit the returned arena after consuming the message.
pub fn decode(allocator: std.mem.Allocator, bytes: []const u8, operations: []const []const u8) !std.json.Parsed(Value) {
    if (bytes.len > max_message_bytes) return error.TooLarge;
    var parsed = std.json.parseFromSlice(Value, allocator, bytes, .{
        .allocate = .alloc_always,
        .duplicate_field_behavior = .use_last,
    }) catch |err| switch (err) {
        error.OutOfMemory => return err,
        else => return error.Invalid,
    };
    errdefer parsed.deinit();
    try validate(parsed.value, operations);
    return parsed;
}

pub fn encode(allocator: std.mem.Allocator, value: Value, operations: []const []const u8) ![]u8 {
    try validate(value, operations);
    const bytes = try std.json.Stringify.valueAlloc(allocator, value, .{});
    errdefer allocator.free(bytes);
    if (bytes.len > max_message_bytes) return error.TooLarge;
    return bytes;
}

/// Check correlation/status before exposing a response. No state is mutated.
pub fn response(value: Value, request: Value, status: u16) ProtocolError!void {
    try check(eq(get(value, "kind"), "response"));
    for ([_][]const u8{ "generation", "operation", "id" }) |key|
        try check(eq(get(value, key), text(get(request, key))));
    const expected = if (value.object.get("error")) |err|
        errorStatus(text(get(err, "code"))) orelse return error.Invalid
    else
        200;
    try check(expected == status);
}

/// Framing only. A returned slice lasts until the next push; any framing error
/// poisons the channel. Feed arbitrary fragmented/coalesced reads byte by byte.
pub const Frames = struct {
    buffer: std.ArrayList(u8) = .empty,
    complete: bool = false,
    failed: bool = false,

    pub fn deinit(self: *Frames, allocator: std.mem.Allocator) void {
        self.buffer.deinit(allocator);
    }

    pub fn push(self: *Frames, allocator: std.mem.Allocator, byte: u8) !?[]const u8 {
        try check(!self.failed);
        if (self.complete) {
            self.buffer.clearRetainingCapacity();
            self.complete = false;
        }
        if (byte == '\n') {
            if (self.buffer.items.len == 0 or self.buffer.getLast() == '\r') {
                self.failed = true;
                return error.Invalid;
            }
            self.complete = true;
            return self.buffer.items;
        }
        if (self.buffer.items.len == max_message_bytes) {
            self.failed = true;
            return error.TooLarge;
        }
        self.buffer.append(allocator, byte) catch |err| {
            self.failed = true;
            return err;
        };
        return null;
    }

    pub fn finish(self: *const Frames) ProtocolError!void {
        try check(!self.failed);
        if (!self.complete and self.buffer.items.len != 0) return error.Truncated;
    }
};
