const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Static library for linking into Tauri
    const lib = b.addStaticLibrary(.{
        .name = "mtcore",
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
    });

    // Link TagLib for metadata extraction (via pkg-config)
    lib.linkSystemLibrary2("taglib_c", .{
        .use_pkg_config = .force,
    });
    lib.linkLibC();

    b.installArtifact(lib);

    // Shared library for development/testing
    const shared = b.addSharedLibrary(.{
        .name = "mtcore",
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
    });
    shared.linkSystemLibrary2("taglib_c", .{
        .use_pkg_config = .force,
    });
    shared.linkLibC();

    const shared_step = b.step("shared", "Build shared library");
    shared_step.dependOn(&b.addInstallArtifact(shared, .{}).step);

    // Unit tests
    const lib_tests = b.addTest(.{
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
    });
    lib_tests.linkSystemLibrary2("taglib_c", .{
        .use_pkg_config = .force,
    });
    lib_tests.linkLibC();

    const run_lib_tests = b.addRunArtifact(lib_tests);
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_lib_tests.step);
}
