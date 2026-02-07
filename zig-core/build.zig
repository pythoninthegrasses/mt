const std = @import("std");

/// Resolve the vendor/taglib directory relative to the project root.
/// build.zig lives in zig-core/, so ../vendor/taglib/ is the vendor path.
const vendor_taglib_include = "../vendor/taglib/include";
const vendor_taglib_lib = "../vendor/taglib/lib";

fn addTagLibPaths(step: *std.Build.Step.Compile, b: *std.Build) void {
    step.addIncludePath(b.path(vendor_taglib_include));
    step.addLibraryPath(b.path(vendor_taglib_lib));
}

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

    // Only include path needed — actual TagLib linking is handled by Rust build.rs
    addTagLibPaths(lib, b);
    lib.linkLibC();

    b.installArtifact(lib);

    // Shared library for development/testing
    const shared = b.addSharedLibrary(.{
        .name = "mtcore",
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
    });
    addTagLibPaths(shared, b);
    shared.linkSystemLibrary2("tag_c", .{
        .use_pkg_config = .no,
        .preferred_link_mode = .static,
    });
    shared.linkSystemLibrary2("tag", .{
        .use_pkg_config = .no,
        .preferred_link_mode = .static,
    });
    shared.linkSystemLibrary("z");
    shared.linkLibCpp();
    shared.linkLibC();

    const shared_step = b.step("shared", "Build shared library");
    shared_step.dependOn(&b.addInstallArtifact(shared, .{}).step);

    // Unit tests
    const lib_tests = b.addTest(.{
        .root_source_file = b.path("src/lib.zig"),
        .target = target,
        .optimize = optimize,
    });
    addTagLibPaths(lib_tests, b);
    lib_tests.linkSystemLibrary2("tag_c", .{
        .use_pkg_config = .no,
        .preferred_link_mode = .static,
    });
    lib_tests.linkSystemLibrary2("tag", .{
        .use_pkg_config = .no,
        .preferred_link_mode = .static,
    });
    lib_tests.linkSystemLibrary("z");
    lib_tests.linkLibCpp();
    lib_tests.linkLibC();

    const run_lib_tests = b.addRunArtifact(lib_tests);
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_lib_tests.step);
}
