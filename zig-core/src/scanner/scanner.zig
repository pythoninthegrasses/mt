//! Scanner module - filesystem scanning and metadata extraction

pub const metadata = @import("metadata.zig");
pub const fingerprint = @import("fingerprint.zig");

const std = @import("std");
const types = @import("../types.zig");

pub const ExtractedMetadata = types.ExtractedMetadata;
pub const FileFingerprint = types.FileFingerprint;
pub const ScanStats = types.ScanStats;
pub const ScanError = types.ScanError;

/// Re-export main functions
pub const extractMetadata = metadata.extractMetadata;
pub const extractMetadataBatch = metadata.extractMetadataBatch;

test {
    std.testing.refAllDecls(@This());
}
