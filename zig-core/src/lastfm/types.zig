//! Last.fm API types and signature generation.
//!
//! Implements Last.fm API authentication and request signing.
//! Reference: https://www.last.fm/api/authspec

const std = @import("std");
const Allocator = std.mem.Allocator;
const Md5 = std.crypto.hash.Md5;

/// Last.fm API method
pub const Method = enum {
    track_updateNowPlaying,
    track_scrobble,
    auth_getSession,
    auth_getToken,
    user_getInfo,
    track_love,
    track_unlove,
    album_getInfo,
    artist_getInfo,

    pub fn toString(self: Method) []const u8 {
        return switch (self) {
            .track_updateNowPlaying => "track.updateNowPlaying",
            .track_scrobble => "track.scrobble",
            .auth_getSession => "auth.getSession",
            .auth_getToken => "auth.getToken",
            .user_getInfo => "user.getInfo",
            .track_love => "track.love",
            .track_unlove => "track.unlove",
            .album_getInfo => "album.getInfo",
            .artist_getInfo => "artist.getInfo",
        };
    }
};

/// API request parameters
/// Note: Does NOT own the strings - caller must ensure they outlive Params
pub const Params = struct {
    allocator: Allocator,
    map: std.StringHashMap([]const u8),

    pub fn init(allocator: Allocator) Params {
        return Params{
            .allocator = allocator,
            .map = std.StringHashMap([]const u8).init(allocator),
        };
    }

    pub fn deinit(self: *Params) void {
        self.map.deinit();
    }

    pub fn put(self: *Params, key: []const u8, value: []const u8) !void {
        try self.map.put(key, value);
    }

    pub fn get(self: *const Params, key: []const u8) ?[]const u8 {
        return self.map.get(key);
    }

    pub fn count(self: *const Params) usize {
        return self.map.count();
    }

    /// Get all keys sorted alphabetically
    pub fn getSortedKeys(self: *const Params, allocator: Allocator) ![][]const u8 {
        const count_val = self.map.count();
        if (count_val == 0) return &[_][]const u8{};

        var keys = try allocator.alloc([]const u8, count_val);
        var i: usize = 0;
        var iter = self.map.keyIterator();
        while (iter.next()) |key| {
            keys[i] = key.*;
            i += 1;
        }

        // Sort keys alphabetically
        std.mem.sort([]const u8, keys, {}, struct {
            pub fn lessThan(_: void, a: []const u8, b: []const u8) bool {
                return std.mem.order(u8, a, b) == .lt;
            }
        }.lessThan);

        return keys;
    }
};

/// Generate Last.fm API signature
/// Returns a 32-character hex string (MD5 hash)
/// Caller owns the returned slice
pub fn generateSignature(allocator: Allocator, params: *const Params, api_secret: []const u8) ![]u8 {
    // Step 1: Get sorted keys
    const keys = try params.getSortedKeys(allocator);
    defer allocator.free(keys);

    // Step 2: Calculate total length needed
    var total_len: usize = 0;
    for (keys) |key| {
        total_len += key.len;
        if (params.get(key)) |value| {
            total_len += value.len;
        }
    }
    total_len += api_secret.len;

    // Step 3: Build signature string (keyvalue pairs + secret)
    var sig_string = try allocator.alloc(u8, total_len);
    defer allocator.free(sig_string);

    var pos: usize = 0;
    for (keys) |key| {
        @memcpy(sig_string[pos .. pos + key.len], key);
        pos += key.len;
        if (params.get(key)) |value| {
            @memcpy(sig_string[pos .. pos + value.len], value);
            pos += value.len;
        }
    }
    @memcpy(sig_string[pos .. pos + api_secret.len], api_secret);

    // Step 4: Calculate MD5 hash
    var hash: [Md5.digest_length]u8 = undefined;
    Md5.hash(sig_string, &hash, .{});

    // Step 5: Convert to hex string
    const hex_chars = "0123456789abcdef";
    var result = try allocator.alloc(u8, 32);
    for (hash, 0..) |byte, i| {
        result[i * 2] = hex_chars[byte >> 4];
        result[i * 2 + 1] = hex_chars[byte & 0x0F];
    }

    return result;
}

/// Generate signature for a slice of key-value pairs (convenience function)
/// Pairs must be in format: [[key1, value1], [key2, value2], ...]
pub fn generateSignatureFromPairs(
    allocator: Allocator,
    pairs: []const [2][]const u8,
    api_secret: []const u8,
) ![]u8 {
    var params = Params.init(allocator);
    defer params.deinit();

    for (pairs) |pair| {
        try params.put(pair[0], pair[1]);
    }

    return generateSignature(allocator, &params, api_secret);
}

/// Scrobble request (FFI-safe with fixed buffers)
pub const ScrobbleRequest = extern struct {
    artist: [512]u8,
    artist_len: u32,
    track: [512]u8,
    track_len: u32,
    album: [512]u8,
    album_len: u32,
    timestamp: i64,
    duration: i32,
    track_number: u32,

    pub fn init() ScrobbleRequest {
        var req = ScrobbleRequest{
            .artist = undefined,
            .artist_len = 0,
            .track = undefined,
            .track_len = 0,
            .album = undefined,
            .album_len = 0,
            .timestamp = 0,
            .duration = 0,
            .track_number = 0,
        };
        @memset(&req.artist, 0);
        @memset(&req.track, 0);
        @memset(&req.album, 0);
        return req;
    }

    pub fn getArtist(self: *const ScrobbleRequest) []const u8 {
        return self.artist[0..self.artist_len];
    }

    pub fn getTrack(self: *const ScrobbleRequest) []const u8 {
        return self.track[0..self.track_len];
    }

    pub fn getAlbum(self: *const ScrobbleRequest) []const u8 {
        return self.album[0..self.album_len];
    }

    pub fn setArtist(self: *ScrobbleRequest, value: []const u8) void {
        const len = @min(value.len, self.artist.len);
        @memcpy(self.artist[0..len], value[0..len]);
        self.artist_len = @intCast(len);
    }

    pub fn setTrack(self: *ScrobbleRequest, value: []const u8) void {
        const len = @min(value.len, self.track.len);
        @memcpy(self.track[0..len], value[0..len]);
        self.track_len = @intCast(len);
    }

    pub fn setAlbum(self: *ScrobbleRequest, value: []const u8) void {
        const len = @min(value.len, self.album.len);
        @memcpy(self.album[0..len], value[0..len]);
        self.album_len = @intCast(len);
    }
};

/// Now playing request (FFI-safe with fixed buffers)
pub const NowPlayingRequest = extern struct {
    artist: [512]u8,
    artist_len: u32,
    track: [512]u8,
    track_len: u32,
    album: [512]u8,
    album_len: u32,
    duration: i32,
    track_number: u32,

    pub fn init() NowPlayingRequest {
        var req = NowPlayingRequest{
            .artist = undefined,
            .artist_len = 0,
            .track = undefined,
            .track_len = 0,
            .album = undefined,
            .album_len = 0,
            .duration = 0,
            .track_number = 0,
        };
        @memset(&req.artist, 0);
        @memset(&req.track, 0);
        @memset(&req.album, 0);
        return req;
    }

    pub fn getArtist(self: *const NowPlayingRequest) []const u8 {
        return self.artist[0..self.artist_len];
    }

    pub fn getTrack(self: *const NowPlayingRequest) []const u8 {
        return self.track[0..self.track_len];
    }

    pub fn getAlbum(self: *const NowPlayingRequest) []const u8 {
        return self.album[0..self.album_len];
    }
};

/// API response status
pub const Status = enum {
    ok,
    failed,
};

/// API error codes from Last.fm
pub const ErrorCode = enum(u32) {
    invalid_service = 2,
    invalid_method = 3,
    authentication_failed = 4,
    invalid_format = 5,
    invalid_parameters = 6,
    invalid_resource = 7,
    operation_failed = 8,
    invalid_session_key = 9,
    invalid_api_key = 10,
    service_offline = 11,
    invalid_signature = 13,
    token_not_authorized = 14,
    token_expired = 15,
    rate_limit_exceeded = 29,
    _,
};

// =============================================================================
// Tests
// =============================================================================

test "Method toString" {
    try std.testing.expectEqualStrings("track.scrobble", Method.track_scrobble.toString());
    try std.testing.expectEqualStrings("track.updateNowPlaying", Method.track_updateNowPlaying.toString());
    try std.testing.expectEqualStrings("auth.getSession", Method.auth_getSession.toString());
    try std.testing.expectEqualStrings("user.getInfo", Method.user_getInfo.toString());
}

test "Params add and get" {
    const allocator = std.testing.allocator;
    var params = Params.init(allocator);
    defer params.deinit();

    try params.put("api_key", "test_key");
    try params.put("method", "auth.getSession");

    try std.testing.expectEqualStrings("test_key", params.get("api_key").?);
    try std.testing.expectEqualStrings("auth.getSession", params.get("method").?);
    try std.testing.expect(params.get("nonexistent") == null);
    try std.testing.expectEqual(@as(usize, 2), params.count());
}

test "Params getSortedKeys" {
    const allocator = std.testing.allocator;
    var params = Params.init(allocator);
    defer params.deinit();

    try params.put("method", "track.scrobble");
    try params.put("api_key", "abc123");
    try params.put("artist", "Test Artist");

    const keys = try params.getSortedKeys(allocator);
    defer allocator.free(keys);

    try std.testing.expectEqual(@as(usize, 3), keys.len);
    try std.testing.expectEqualStrings("api_key", keys[0]);
    try std.testing.expectEqualStrings("artist", keys[1]);
    try std.testing.expectEqualStrings("method", keys[2]);
}

test "generateSignature basic" {
    const allocator = std.testing.allocator;
    var params = Params.init(allocator);
    defer params.deinit();

    try params.put("api_key", "xxxxxxxxx");
    try params.put("method", "auth.getSession");
    try params.put("token", "yyyyyyyyy");

    // Generate signature with secret "secret"
    const sig = try generateSignature(allocator, &params, "secret");
    defer allocator.free(sig);

    // The signature should be 32 hex characters
    try std.testing.expectEqual(@as(usize, 32), sig.len);

    // Verify it's all hex characters
    for (sig) |c| {
        try std.testing.expect((c >= '0' and c <= '9') or (c >= 'a' and c <= 'f'));
    }
}

test "generateSignature known value" {
    // Test with known input to verify correctness
    // Sorted params: api_key, method, token
    // Concatenation: "api_keyxxxxxxxxxmethodauth.getSessiontokenyyyyyyyyyysecret"
    // MD5 hash verified with: echo -n "api_keyxxxxxxxxxmethodauth.getSessiontokenyyyyyyyyyysecret" | md5
    const allocator = std.testing.allocator;
    var params = Params.init(allocator);
    defer params.deinit();

    try params.put("api_key", "xxxxxxxxx");
    try params.put("method", "auth.getSession");
    try params.put("token", "yyyyyyyyy");

    const sig = try generateSignature(allocator, &params, "secret");
    defer allocator.free(sig);

    // Verified with: echo -n "api_keyxxxxxxxxxmethodauth.getSessiontokenyyyyyyyyyysecret" | md5
    try std.testing.expectEqualStrings("394a52ef2936a8fdb1afd78fabe30d10", sig);
}

test "generateSignatureFromPairs" {
    const allocator = std.testing.allocator;
    const pairs = [_][2][]const u8{
        .{ "api_key", "test" },
        .{ "method", "user.getInfo" },
    };

    const sig = try generateSignatureFromPairs(allocator, &pairs, "mysecret");
    defer allocator.free(sig);

    try std.testing.expectEqual(@as(usize, 32), sig.len);
}

test "ScrobbleRequest initialization" {
    var req = ScrobbleRequest.init();
    try std.testing.expectEqual(@as(u32, 0), req.artist_len);
    try std.testing.expectEqual(@as(u32, 0), req.track_len);

    req.setArtist("Test Artist");
    req.setTrack("Test Track");
    req.setAlbum("Test Album");

    try std.testing.expectEqualStrings("Test Artist", req.getArtist());
    try std.testing.expectEqualStrings("Test Track", req.getTrack());
    try std.testing.expectEqualStrings("Test Album", req.getAlbum());
}

test "NowPlayingRequest initialization" {
    const req = NowPlayingRequest.init();
    try std.testing.expectEqual(@as(u32, 0), req.artist_len);
    try std.testing.expectEqual(@as(u32, 0), req.track_len);
    try std.testing.expectEqual(@as(i32, 0), req.duration);
}

test "ErrorCode values" {
    try std.testing.expectEqual(@as(u32, 4), @intFromEnum(ErrorCode.authentication_failed));
    try std.testing.expectEqual(@as(u32, 9), @intFromEnum(ErrorCode.invalid_session_key));
    try std.testing.expectEqual(@as(u32, 29), @intFromEnum(ErrorCode.rate_limit_exceeded));
}
