const std = @import("std");

// SQLite amalgamation compile flags, carried from libsqlite3-sys' build.rs
// (rusqlite 0.38 / libsqlite3-sys 0.36) minus extensions unused anywhere in
// crates/mt-tauri/src/db (FTS3/4/5, RTREE, JSON1, SOUNDEX, DBSTAT_VTAB,
// MEMORY_MANAGEMENT, ENABLE_LOAD_EXTENSION) — see zig-core/README.md.
//
// SQLITE_ENABLE_LOCKING_STYLE=0 is the mechanism behind the no-system-
// framework constraint: it defaults to 1 on Apple platforms (sqlite3.c),
// pulling in Darwin-specific VFS code that requires a macOS SDK to build,
// which would defeat cross-compiling all four targets from one host.
const sqlite_flags = [_][]const u8{
    "-DSQLITE_CORE",
    "-DSQLITE_DEFAULT_FOREIGN_KEYS=1",
    "-DSQLITE_ENABLE_API_ARMOR",
    "-DSQLITE_ENABLE_COLUMN_METADATA",
    "-DSQLITE_ENABLE_STAT4",
    "-DSQLITE_THREADSAFE=1",
    "-DSQLITE_USE_URI",
    "-DSQLITE_ENABLE_LOCKING_STYLE=0",
    "-DSQLITE_OMIT_LOAD_EXTENSION",
    "-DHAVE_USLEEP=1",
    "-DHAVE_ISNAN",
    "-D_POSIX_THREAD_SAFE_FUNCTIONS",
};

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const sqlite_mod = b.createModule(.{
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    sqlite_mod.addIncludePath(b.path("vendor/sqlite3"));
    sqlite_mod.addCSourceFile(.{
        .file = b.path("vendor/sqlite3/sqlite3.c"),
        .flags = &sqlite_flags,
    });
    // SQLite is not clean under Zig 0.15's default UBSan (Debug/ReleaseSafe
    // enable it as `full`); it aborts at runtime on constructs the C code
    // relies on (e.g. signed overflow in hash functions). Match rusqlite,
    // which does not build SQLite with a C sanitizer either.
    sqlite_mod.sanitize_c = .off;

    const sqlite_lib = b.addLibrary(.{
        .linkage = .static,
        .name = "sqlite3",
        .root_module = sqlite_mod,
    });
    sqlite_lib.installHeader(b.path("vendor/sqlite3/sqlite3.h"), "sqlite3.h");
    b.installArtifact(sqlite_lib);

    // Sidecar executable.
    const exe_mod = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    exe_mod.linkLibrary(sqlite_lib);
    exe_mod.addIncludePath(b.path("vendor/sqlite3"));

    const exe = b.addExecutable(.{
        .name = "mt-zig-core",
        .root_module = exe_mod,
    });
    b.installArtifact(exe);

    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| run_cmd.addArgs(args);
    const run_step = b.step("run", "Run the sidecar");
    run_step.dependOn(&run_cmd.step);

    const exe_tests = b.addTest(.{
        .root_module = exe_mod,
    });
    const run_exe_tests = b.addRunArtifact(exe_tests);
    // A cross-target `zig build test -Dtarget=...` produces a test binary
    // for a foreign architecture that this host cannot execute; skip
    // running it rather than hard-failing so `task zig:cross-compile` stays
    // a pure compile check.
    run_exe_tests.skip_foreign_checks = true;

    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_exe_tests.step);
}
