const std = @import("std");
const sqlite = @import("sqlite.zig");

pub fn main() !void {
    // Prints to stderr, ignoring potential errors.
    std.debug.print("mt-zig-core (sqlite {s})\n", .{sqlite.libVersion()});
}

test "sanity" {
    try std.testing.expect(1 + 1 == 2);
}

test {
    _ = @import("sqlite.zig");
    _ = @import("strip_sort_prefix.zig");
}
