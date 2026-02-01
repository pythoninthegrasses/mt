//! Last.fm API client with rate limiting and configuration.
//!
//! This module provides request building and rate limiting for Last.fm API.
//! Actual HTTP requests are delegated to Rust (via reqwest) since Zig's stdlib
//! doesn't include an HTTP client. The client builds signed request bodies
//! that can be passed to FFI for execution.

const std = @import("std");
const types = @import("types.zig");
const Allocator = std.mem.Allocator;

/// Last.fm API base URL
pub const API_BASE_URL = "https://ws.audioscrobbler.com/2.0/";

// =============================================================================
// Rate Limiter
// =============================================================================

/// Rate limiter state - enforces minimum interval between requests
pub const RateLimiter = struct {
    mutex: std.Thread.Mutex,
    last_request_ns: i64, // nanoseconds since epoch
    min_interval_ns: i64, // minimum nanoseconds between requests

    /// Initialize rate limiter with specified requests per second
    /// Last.fm recommends max 5 requests per second
    pub fn init(requests_per_second: f64) RateLimiter {
        const ns_per_second: f64 = 1_000_000_000.0;
        const interval_ns: i64 = @intFromFloat(ns_per_second / requests_per_second);

        return RateLimiter{
            .mutex = .{},
            .last_request_ns = 0,
            .min_interval_ns = interval_ns,
        };
    }

    /// Initialize with default rate (5 req/sec per Last.fm docs)
    pub fn initDefault() RateLimiter {
        return init(5.0);
    }

    /// Wait for a rate limit slot, blocking if necessary
    /// Thread-safe - multiple threads can call this concurrently
    pub fn waitForSlot(self: *RateLimiter) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        const now_ns: i64 = @intCast(std.time.nanoTimestamp());
        const elapsed_ns = now_ns - self.last_request_ns;

        if (elapsed_ns < self.min_interval_ns) {
            const sleep_ns: u64 = @intCast(self.min_interval_ns - elapsed_ns);
            std.time.sleep(sleep_ns);
        }

        self.last_request_ns = @intCast(std.time.nanoTimestamp());
    }

    /// Check if a request can be made immediately without waiting
    /// Returns the wait time in nanoseconds, or 0 if no wait needed
    pub fn getWaitTime(self: *RateLimiter) u64 {
        self.mutex.lock();
        defer self.mutex.unlock();

        const now_ns: i64 = @intCast(std.time.nanoTimestamp());
        const elapsed_ns = now_ns - self.last_request_ns;

        if (elapsed_ns >= self.min_interval_ns) {
            return 0;
        }
        return @intCast(self.min_interval_ns - elapsed_ns);
    }

    /// Record that a request was made (for external HTTP callers)
    pub fn recordRequest(self: *RateLimiter) void {
        self.mutex.lock();
        defer self.mutex.unlock();
        self.last_request_ns = @intCast(std.time.nanoTimestamp());
    }
};

// =============================================================================
// Client Configuration
// =============================================================================

/// Client configuration - stores API credentials
pub const Config = struct {
    api_key: []const u8,
    api_secret: []const u8,
    session_key: ?[]const u8,

    pub fn init(api_key: []const u8, api_secret: []const u8) Config {
        return Config{
            .api_key = api_key,
            .api_secret = api_secret,
            .session_key = null,
        };
    }
};

// =============================================================================
// Request/Response Types (FFI-safe)
// =============================================================================

/// Built request ready for HTTP execution (FFI-safe)
pub const BuiltRequest = extern struct {
    /// URL-encoded POST body
    body: [8192]u8,
    body_len: u32,
    /// HTTP method (always "POST" for Last.fm)
    method: [16]u8,
    method_len: u32,
    /// API method name for logging
    api_method: [64]u8,
    api_method_len: u32,

    pub fn init() BuiltRequest {
        var req = BuiltRequest{
            .body = undefined,
            .body_len = 0,
            .method = undefined,
            .method_len = 0,
            .api_method = undefined,
            .api_method_len = 0,
        };
        @memset(&req.body, 0);
        @memset(&req.method, 0);
        @memset(&req.api_method, 0);

        // Set default method to POST
        const post = "POST";
        @memcpy(req.method[0..post.len], post);
        req.method_len = post.len;

        return req;
    }

    pub fn getBody(self: *const BuiltRequest) []const u8 {
        return self.body[0..self.body_len];
    }

    pub fn getMethod(self: *const BuiltRequest) []const u8 {
        return self.method[0..self.method_len];
    }

    pub fn getApiMethod(self: *const BuiltRequest) []const u8 {
        return self.api_method[0..self.api_method_len];
    }

    fn setBody(self: *BuiltRequest, data: []const u8) void {
        const len = @min(data.len, self.body.len);
        @memcpy(self.body[0..len], data[0..len]);
        self.body_len = @intCast(len);
    }

    fn setApiMethod(self: *BuiltRequest, method_name: []const u8) void {
        const len = @min(method_name.len, self.api_method.len);
        @memcpy(self.api_method[0..len], method_name[0..len]);
        self.api_method_len = @intCast(len);
    }
};

/// API response status (FFI-safe)
pub const ApiResponse = extern struct {
    success: bool,
    error_code: u32, // 0 if success, Last.fm error code otherwise
    error_message: [512]u8,
    error_message_len: u32,

    pub fn initSuccess() ApiResponse {
        var resp = ApiResponse{
            .success = true,
            .error_code = 0,
            .error_message = undefined,
            .error_message_len = 0,
        };
        @memset(&resp.error_message, 0);
        return resp;
    }

    pub fn initError(code: u32, message: []const u8) ApiResponse {
        var resp = ApiResponse{
            .success = false,
            .error_code = code,
            .error_message = undefined,
            .error_message_len = 0,
        };
        @memset(&resp.error_message, 0);
        const len = @min(message.len, resp.error_message.len);
        @memcpy(resp.error_message[0..len], message[0..len]);
        resp.error_message_len = @intCast(len);
        return resp;
    }

    pub fn getErrorMessage(self: *const ApiResponse) []const u8 {
        return self.error_message[0..self.error_message_len];
    }
};

// =============================================================================
// Last.fm API Client
// =============================================================================

/// Last.fm API client - builds signed requests for FFI execution
pub const Client = struct {
    allocator: Allocator,
    config: Config,
    rate_limiter: RateLimiter,

    /// Initialize client with API credentials
    pub fn init(allocator: Allocator, api_key: []const u8, api_secret: []const u8) !*Client {
        const client = try allocator.create(Client);
        client.* = Client{
            .allocator = allocator,
            .config = Config.init(api_key, api_secret),
            .rate_limiter = RateLimiter.initDefault(),
        };
        return client;
    }

    /// Clean up client resources
    pub fn deinit(self: *Client) void {
        self.allocator.destroy(self);
    }

    /// Set session key for authenticated requests
    pub fn setSessionKey(self: *Client, session_key: []const u8) void {
        self.config.session_key = session_key;
    }

    /// Clear session key (logout)
    pub fn clearSessionKey(self: *Client) void {
        self.config.session_key = null;
    }

    /// Check if client has a session key
    pub fn isAuthenticated(self: *const Client) bool {
        return self.config.session_key != null;
    }

    /// Build a scrobble request (track.scrobble)
    /// Returns a BuiltRequest that can be passed to FFI for HTTP execution
    pub fn buildScrobbleRequest(
        self: *Client,
        request: *const types.ScrobbleRequest,
    ) !BuiltRequest {
        var params = types.Params.init(self.allocator);
        defer params.deinit();

        // Add required parameters
        try params.put("method", types.Method.track_scrobble.toString());
        try params.put("api_key", self.config.api_key);
        try params.put("artist", request.getArtist());
        try params.put("track", request.getTrack());

        // Format timestamp as string
        var timestamp_buf: [32]u8 = undefined;
        const timestamp_str = std.fmt.bufPrint(&timestamp_buf, "{d}", .{request.timestamp}) catch return error.FormatError;
        try params.put("timestamp", timestamp_str);

        // Add optional parameters
        const album = request.getAlbum();
        if (album.len > 0) {
            try params.put("album", album);
        }

        if (request.duration > 0) {
            var duration_buf: [16]u8 = undefined;
            const duration_str = std.fmt.bufPrint(&duration_buf, "{d}", .{request.duration}) catch return error.FormatError;
            try params.put("duration", duration_str);
        }

        if (request.track_number > 0) {
            var tracknum_buf: [16]u8 = undefined;
            const tracknum_str = std.fmt.bufPrint(&tracknum_buf, "{d}", .{request.track_number}) catch return error.FormatError;
            try params.put("trackNumber", tracknum_str);
        }

        // Add session key for authentication
        if (self.config.session_key) |sk| {
            try params.put("sk", sk);
        }

        return self.buildRequest(types.Method.track_scrobble, &params);
    }

    /// Build a now playing request (track.updateNowPlaying)
    pub fn buildNowPlayingRequest(
        self: *Client,
        request: *const types.NowPlayingRequest,
    ) !BuiltRequest {
        var params = types.Params.init(self.allocator);
        defer params.deinit();

        // Add required parameters
        try params.put("method", types.Method.track_updateNowPlaying.toString());
        try params.put("api_key", self.config.api_key);
        try params.put("artist", request.getArtist());
        try params.put("track", request.getTrack());

        // Add optional parameters
        const album = request.getAlbum();
        if (album.len > 0) {
            try params.put("album", album);
        }

        if (request.duration > 0) {
            var duration_buf: [16]u8 = undefined;
            const duration_str = std.fmt.bufPrint(&duration_buf, "{d}", .{request.duration}) catch return error.FormatError;
            try params.put("duration", duration_str);
        }

        if (request.track_number > 0) {
            var tracknum_buf: [16]u8 = undefined;
            const tracknum_str = std.fmt.bufPrint(&tracknum_buf, "{d}", .{request.track_number}) catch return error.FormatError;
            try params.put("trackNumber", tracknum_str);
        }

        // Add session key for authentication
        if (self.config.session_key) |sk| {
            try params.put("sk", sk);
        }

        return self.buildRequest(types.Method.track_updateNowPlaying, &params);
    }

    /// Build a generic signed request
    fn buildRequest(
        self: *Client,
        method: types.Method,
        params: *types.Params,
    ) !BuiltRequest {
        // Generate signature
        const signature = try types.generateSignature(self.allocator, params, self.config.api_secret);
        defer self.allocator.free(signature);

        // Build URL-encoded body
        var result = BuiltRequest.init();
        result.setApiMethod(method.toString());

        // Build body: key1=value1&key2=value2&...&api_sig=SIGNATURE&format=json
        var body_builder = std.ArrayList(u8).init(self.allocator);
        defer body_builder.deinit();

        var first = true;
        var iter = params.map.iterator();
        while (iter.next()) |entry| {
            if (!first) {
                try body_builder.append('&');
            }
            first = false;

            // URL encode key and value
            try urlEncode(&body_builder, entry.key_ptr.*);
            try body_builder.append('=');
            try urlEncode(&body_builder, entry.value_ptr.*);
        }

        // Add signature
        try body_builder.appendSlice("&api_sig=");
        try body_builder.appendSlice(signature);

        // Add format=json
        try body_builder.appendSlice("&format=json");

        result.setBody(body_builder.items);
        return result;
    }

    /// Wait for rate limit slot before making request
    pub fn waitForRateLimit(self: *Client) void {
        self.rate_limiter.waitForSlot();
    }

    /// Get rate limiter for external use
    pub fn getRateLimiter(self: *Client) *RateLimiter {
        return &self.rate_limiter;
    }
};

// =============================================================================
// URL Encoding
// =============================================================================

/// URL-encode a string, appending to the output ArrayList
fn urlEncode(output: *std.ArrayList(u8), input: []const u8) !void {
    const hex_chars = "0123456789ABCDEF";

    for (input) |c| {
        if (isUnreserved(c)) {
            try output.append(c);
        } else if (c == ' ') {
            try output.append('+');
        } else {
            try output.append('%');
            try output.append(hex_chars[c >> 4]);
            try output.append(hex_chars[c & 0x0F]);
        }
    }
}

/// Check if character is unreserved (doesn't need encoding)
fn isUnreserved(c: u8) bool {
    return (c >= 'A' and c <= 'Z') or
        (c >= 'a' and c <= 'z') or
        (c >= '0' and c <= '9') or
        c == '-' or c == '_' or c == '.' or c == '~';
}

// =============================================================================
// Tests
// =============================================================================

test "RateLimiter initialization" {
    const limiter = RateLimiter.init(5.0);
    // 5 req/sec = 200ms interval = 200_000_000 ns
    try std.testing.expectEqual(@as(i64, 200_000_000), limiter.min_interval_ns);
}

test "RateLimiter default initialization" {
    const limiter = RateLimiter.initDefault();
    // Default is 5 req/sec
    try std.testing.expectEqual(@as(i64, 200_000_000), limiter.min_interval_ns);
}

test "RateLimiter getWaitTime" {
    var limiter = RateLimiter.init(10.0); // 10 req/sec = 100ms interval

    // First request should have no wait
    const wait1 = limiter.getWaitTime();
    try std.testing.expectEqual(@as(u64, 0), wait1);
}

test "Config initialization" {
    const config = Config.init("test_key", "test_secret");
    try std.testing.expectEqualStrings("test_key", config.api_key);
    try std.testing.expectEqualStrings("test_secret", config.api_secret);
    try std.testing.expect(config.session_key == null);
}

test "Client initialization" {
    const allocator = std.testing.allocator;

    const client = try Client.init(allocator, "api_key", "api_secret");
    defer client.deinit();

    try std.testing.expectEqualStrings("api_key", client.config.api_key);
    try std.testing.expectEqualStrings("api_secret", client.config.api_secret);
    try std.testing.expect(!client.isAuthenticated());
}

test "Client session key management" {
    const allocator = std.testing.allocator;

    const client = try Client.init(allocator, "api_key", "api_secret");
    defer client.deinit();

    try std.testing.expect(!client.isAuthenticated());

    client.setSessionKey("session123");
    try std.testing.expect(client.isAuthenticated());
    try std.testing.expectEqualStrings("session123", client.config.session_key.?);

    client.clearSessionKey();
    try std.testing.expect(!client.isAuthenticated());
}

test "BuiltRequest initialization" {
    const req = BuiltRequest.init();
    try std.testing.expectEqual(@as(u32, 0), req.body_len);
    try std.testing.expectEqualStrings("POST", req.getMethod());
}

test "ApiResponse success" {
    const resp = ApiResponse.initSuccess();
    try std.testing.expect(resp.success);
    try std.testing.expectEqual(@as(u32, 0), resp.error_code);
}

test "ApiResponse error" {
    const resp = ApiResponse.initError(4, "Authentication Failed");
    try std.testing.expect(!resp.success);
    try std.testing.expectEqual(@as(u32, 4), resp.error_code);
    try std.testing.expectEqualStrings("Authentication Failed", resp.getErrorMessage());
}

test "URL encoding basic" {
    const allocator = std.testing.allocator;
    var output = std.ArrayList(u8).init(allocator);
    defer output.deinit();

    try urlEncode(&output, "hello world");
    try std.testing.expectEqualStrings("hello+world", output.items);
}

test "URL encoding special characters" {
    const allocator = std.testing.allocator;
    var output = std.ArrayList(u8).init(allocator);
    defer output.deinit();

    try urlEncode(&output, "a=b&c=d");
    try std.testing.expectEqualStrings("a%3Db%26c%3Dd", output.items);
}

test "URL encoding unreserved characters" {
    const allocator = std.testing.allocator;
    var output = std.ArrayList(u8).init(allocator);
    defer output.deinit();

    try urlEncode(&output, "abc-123_test.file~name");
    try std.testing.expectEqualStrings("abc-123_test.file~name", output.items);
}

test "Client buildScrobbleRequest" {
    const allocator = std.testing.allocator;

    const client = try Client.init(allocator, "test_api_key", "test_secret");
    defer client.deinit();

    client.setSessionKey("test_session");

    var scrobble = types.ScrobbleRequest.init();
    scrobble.setArtist("Test Artist");
    scrobble.setTrack("Test Track");
    scrobble.setAlbum("Test Album");
    scrobble.timestamp = 1234567890;
    scrobble.duration = 240;

    const req = try client.buildScrobbleRequest(&scrobble);

    // Verify request was built
    try std.testing.expect(req.body_len > 0);
    try std.testing.expectEqualStrings("track.scrobble", req.getApiMethod());

    // Verify body contains required params (URL encoded)
    const body = req.getBody();
    try std.testing.expect(std.mem.indexOf(u8, body, "api_key=test_api_key") != null);
    try std.testing.expect(std.mem.indexOf(u8, body, "method=track.scrobble") != null);
    try std.testing.expect(std.mem.indexOf(u8, body, "api_sig=") != null);
    try std.testing.expect(std.mem.indexOf(u8, body, "format=json") != null);
}

test "Client buildNowPlayingRequest" {
    const allocator = std.testing.allocator;

    const client = try Client.init(allocator, "test_api_key", "test_secret");
    defer client.deinit();

    client.setSessionKey("test_session");

    var np = types.NowPlayingRequest.init();
    // Can't use setArtist/setTrack since NowPlayingRequest doesn't have them in the types
    // Let's just test the basic flow
    @memcpy(np.artist[0..11], "Test Artist");
    np.artist_len = 11;
    @memcpy(np.track[0..10], "Test Track");
    np.track_len = 10;

    const req = try client.buildNowPlayingRequest(&np);

    // Verify request was built
    try std.testing.expect(req.body_len > 0);
    try std.testing.expectEqualStrings("track.updateNowPlaying", req.getApiMethod());

    // Verify body contains required params
    const body = req.getBody();
    try std.testing.expect(std.mem.indexOf(u8, body, "api_key=test_api_key") != null);
    try std.testing.expect(std.mem.indexOf(u8, body, "api_sig=") != null);
}
