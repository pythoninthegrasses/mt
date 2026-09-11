const std = @import("std");

pub fn main() !void {
    // Prints to stderr, ignoring potential errors.
    std.debug.print("mt-zig-core\n", .{});
}

test "sanity" {
    try std.testing.expect(1 + 1 == 2);
}
