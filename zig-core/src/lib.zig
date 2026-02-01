//! mt-core: Zig implementation of music library business logic
//!
//! This library provides the core functionality for the mt music player,
//! exposed via C ABI for FFI from Rust/Tauri.

const std = @import("std");

// Core types
pub const types = @import("types.zig");

// Scanner modules
pub const scanner = @import("scanner/scanner.zig");
pub const metadata = @import("scanner/metadata.zig");
pub const fingerprint = @import("scanner/fingerprint.zig");
pub const artwork_cache = @import("scanner/artwork_cache.zig");
pub const inventory = @import("scanner/inventory.zig");
pub const orchestration = @import("scanner/orchestration.zig");

// Database modules
pub const db_models = @import("db/models.zig");
pub const db_library = @import("db/library.zig");
pub const db_queue = @import("db/queue.zig");
pub const db_settings = @import("db/settings.zig");

// Last.fm modules
pub const lastfm_types = @import("lastfm/types.zig");
pub const lastfm_client = @import("lastfm/client.zig");

// Re-export FFI functions at library root
pub usingnamespace @import("ffi.zig");

test {
    std.testing.refAllDecls(@This());
}
