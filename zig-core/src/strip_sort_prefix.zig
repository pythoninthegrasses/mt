//! Zig port of the Rust `strip_sort_prefix` (crates/mt-tauri/src/db/models.rs),
//! the function the SQL UDF `strip_sort_prefix` delegates to. Strips the
//! first matching ignore-word prefix from `value`, where the word must be
//! followed by whitespace (so "Therapy?" is not stripped by "the").
//!
//! Case-insensitive matching here is ASCII-only (std.ascii), unlike the
//! Rust side's Unicode-aware `to_lowercase()`. This is a documented,
//! bounded divergence — see zig-core/README.md — that only matters if a
//! user sets a custom ignore word containing a non-ASCII uppercase letter.

const std = @import("std");

const whitespace = " \t\n\r";

pub fn stripSortPrefix(value: []const u8, ignore_words: []const u8) []const u8 {
    var it = std.mem.splitScalar(u8, ignore_words, ',');
    while (it.next()) |raw_word| {
        const word = std.mem.trim(u8, raw_word, whitespace);
        if (word.len == 0) continue;
        if (value.len <= word.len) continue;
        if (!std.ascii.eqlIgnoreCase(value[0..word.len], word)) continue;
        const rest = value[word.len..];
        if (std.mem.indexOfScalar(u8, whitespace, rest[0]) != null) {
            return std.mem.trimLeft(u8, rest, whitespace);
        }
    }
    return value;
}

const testing = std.testing;

const GoldenCase = struct {
    value: ?[]const u8 = null,
    prefixes: ?[]const u8 = null,
    expected: ?[]const u8 = null,
    note: []const u8 = "",
};

test "matches the shared golden fixture" {
    const allocator = testing.allocator;
    const fixture_path = "../tests/fixtures/strip_sort_prefix.json";
    const file = try std.fs.cwd().openFile(fixture_path, .{});
    defer file.close();

    const contents = try file.readToEndAlloc(allocator, 1 << 20);
    defer allocator.free(contents);

    const parsed = try std.json.parseFromSlice([]GoldenCase, allocator, contents, .{
        .ignore_unknown_fields = true,
    });
    defer parsed.deinit();

    var checked: usize = 0;
    for (parsed.value) |case| {
        const value = case.value orelse continue;
        const prefixes = case.prefixes orelse continue;
        const expected = case.expected orelse continue;
        const result = stripSortPrefix(value, prefixes);
        try testing.expectEqualStrings(expected, result);
        checked += 1;
    }
    try testing.expect(checked > 0);
}

test "no prefix matches returns the original value" {
    try testing.expectEqualStrings("Led Zeppelin", stripSortPrefix("Led Zeppelin", "the,a,an"));
}

test "prefix must be followed by whitespace" {
    try testing.expectEqualStrings("Therapy?", stripSortPrefix("Therapy?", "the"));
}

test "matching is ASCII case-insensitive" {
    try testing.expectEqualStrings("ROLLING STONES", stripSortPrefix("THE ROLLING STONES", "the"));
}
