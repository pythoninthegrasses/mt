const std = @import("std");
const protocol = @import("protocol");
const testing = std.testing;
const operations: []const []const u8 = &.{
    "library.getTracks", "native.metadata.read", "engine.changed", "native.audio.ended", "control.cancel",
};
const Fixture = struct { name: []const u8, valid: bool, wire: []const u8, code: ?[]const u8 = null };
const fixtures = @embedFile("messages.jsonl");

test "shared wire fixtures and roundtrips" {
    var lines = std.mem.tokenizeScalar(u8, fixtures, '\n');
    var count: usize = 0;
    while (lines.next()) |line| {
        const fixture = try std.json.parseFromSlice(Fixture, testing.allocator, line, .{});
        defer fixture.deinit();
        if (protocol.decode(testing.allocator, fixture.value.wire, operations)) |parsed| {
            defer parsed.deinit();
            if (!fixture.value.valid) std.debug.print("unexpected valid fixture: {s}\n", .{fixture.value.name});
            try testing.expect(fixture.value.valid);
            const encoded = try protocol.encode(testing.allocator, parsed.value, operations);
            defer testing.allocator.free(encoded);
            const decoded = try protocol.decode(testing.allocator, encoded, operations);
            defer decoded.deinit();
        } else |err| {
            if (fixture.value.valid) std.debug.print("unexpected invalid fixture: {s}: {s}\n", .{ fixture.value.name, @errorName(err) });
            try testing.expect(!fixture.value.valid);
            if (fixture.value.code) |code| {
                if (err == error.OutOfMemory) return err;
                try testing.expectEqualStrings(code, protocol.errorCode(@errorCast(err)));
            }
        }
        count += 1;
    }
    try testing.expect(count >= 40);
}

test "fragmented and coalesced NDJSON including UTF8 and escaped LF" {
    const body =
        \\{"version":1,"kind":"request","generation":"g1","id":"ui:1","operation":"library.getTracks","deadline_ms":1,"payload":{"search":"東京\nsong"}}
    ;
    const wire = body ++ "\n" ++ body ++ "\n";
    for ([_]usize{ 1, 2, 7, wire.len }) |chunk_size| {
        var frames: protocol.Frames = .{};
        defer frames.deinit(testing.allocator);
        var count: usize = 0;
        var offset: usize = 0;
        while (offset < wire.len) {
            const end = @min(offset + chunk_size, wire.len);
            for (wire[offset..end]) |byte| {
                if (try frames.push(testing.allocator, byte)) |frame| {
                    const parsed = try protocol.decode(testing.allocator, frame, operations);
                    parsed.deinit();
                    count += 1;
                }
            }
            offset = end;
        }
        try frames.finish();
        try testing.expectEqual(2, count);
    }
}

test "bounded framing and truncated EOF" {
    var frames: protocol.Frames = .{};
    defer frames.deinit(testing.allocator);
    try testing.expectError(error.Invalid, frames.push(testing.allocator, '\n'));
    try testing.expectError(error.Invalid, frames.push(testing.allocator, 'x'));
    var partial: protocol.Frames = .{};
    defer partial.deinit(testing.allocator);
    _ = try partial.push(testing.allocator, '{');
    try testing.expectError(error.Truncated, partial.finish());
    var crlf: protocol.Frames = .{};
    defer crlf.deinit(testing.allocator);
    _ = try crlf.push(testing.allocator, '\r');
    try testing.expectError(error.Invalid, crlf.push(testing.allocator, '\n'));
    var large: protocol.Frames = .{};
    defer large.deinit(testing.allocator);
    for (0..protocol.max_message_bytes) |_| _ = try large.push(testing.allocator, ' ');
    try testing.expectError(error.TooLarge, large.push(testing.allocator, ' '));
    try testing.expectError(error.Invalid, large.finish());
    const bytes = try testing.allocator.alloc(u8, protocol.max_message_bytes + 1);
    defer testing.allocator.free(bytes);
    @memset(bytes, ' ');
    try testing.expectError(error.TooLarge, protocol.decode(testing.allocator, bytes, operations));
    try testing.expectError(error.Invalid, protocol.decode(testing.allocator, &.{0xff}, operations));
}

test "response correlation status allowlist and depth" {
    const request = try protocol.decode(testing.allocator,
        \\{"version":1,"kind":"request","generation":"g1","id":"ui:1","operation":"library.getTracks","deadline_ms":1,"payload":{}}
    , operations);
    defer request.deinit();
    const reply =
        \\{"version":1,"kind":"response","generation":"g1","id":"ui:1","operation":"library.getTracks","result":[]}
    ;
    const parsed = try protocol.decode(testing.allocator, reply, operations);
    defer parsed.deinit();
    try protocol.response(parsed.value, request.value, 200);
    try testing.expectError(error.Invalid, protocol.response(parsed.value, request.value, 503));
    try testing.expectError(error.UnknownOperation, protocol.decode(testing.allocator, reply, &.{}));
    for ([_][]const u8{ "generation", "operation", "id" }) |key| {
        const old = request.value.object.getPtr(key).?.*;
        request.value.object.getPtr(key).?.* = .{ .string = "other" };
        const changed = request.value;
        try testing.expectError(error.Invalid, protocol.response(parsed.value, changed, 200));
        request.value.object.getPtr(key).?.* = old;
    }
    const failure = try protocol.decode(testing.allocator,
        \\{"version":1,"kind":"response","generation":"g1","id":"ui:1","operation":"library.getTracks","error":{"code":"unavailable","message":"Unavailable","retryable":true}}
    , operations);
    defer failure.deinit();
    try protocol.response(failure.value, request.value, 503);
    try testing.expectError(error.Invalid, protocol.response(failure.value, request.value, 200));
    const deep = try std.fmt.allocPrint(testing.allocator,
        \\{{"version":1,"kind":"response","generation":"g1","id":"ui:1","operation":"library.getTracks","result":{s}null{s}}}
    , .{ "[" ** 33, "]" ** 33 });
    defer testing.allocator.free(deep);
    try testing.expectError(error.Invalid, protocol.decode(testing.allocator, deep, operations));
}
