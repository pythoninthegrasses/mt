//! LRU cache for artwork to reduce IPC calls during queue navigation.
//!
//! Caches recently accessed artwork in memory to avoid repeatedly
//! extracting artwork from files when navigating prev/next in queue.

const std = @import("std");
const Allocator = std.mem.Allocator;

/// Default cache size (number of tracks)
pub const DEFAULT_CACHE_SIZE: usize = 100;

/// Artwork data structure (matches Rust Artwork type)
pub const Artwork = extern struct {
    data: [8192]u8, // Base64-encoded image data (fixed-size buffer)
    data_len: u32,
    mime_type: [64]u8,
    mime_type_len: u32,
    source: [16]u8, // "embedded" or "folder"
    source_len: u32,
    filename: [256]u8,
    filename_len: u32,
    has_filename: bool,

    /// Create an Artwork struct from data
    pub fn init(data: []const u8, mime_type: []const u8, source: []const u8, filename: ?[]const u8) ?Artwork {
        if (data.len > 8192 or mime_type.len > 64 or source.len > 16) {
            return null;
        }

        var artwork = Artwork{
            .data = undefined,
            .data_len = @intCast(data.len),
            .mime_type = undefined,
            .mime_type_len = @intCast(mime_type.len),
            .source = undefined,
            .source_len = @intCast(source.len),
            .filename = undefined,
            .filename_len = 0,
            .has_filename = false,
        };

        // Zero-initialize arrays
        @memset(&artwork.data, 0);
        @memset(&artwork.mime_type, 0);
        @memset(&artwork.source, 0);
        @memset(&artwork.filename, 0);

        // Copy data
        @memcpy(artwork.data[0..data.len], data);
        @memcpy(artwork.mime_type[0..mime_type.len], mime_type);
        @memcpy(artwork.source[0..source.len], source);

        if (filename) |fname| {
            if (fname.len <= 256) {
                @memcpy(artwork.filename[0..fname.len], fname);
                artwork.filename_len = @intCast(fname.len);
                artwork.has_filename = true;
            }
        }

        return artwork;
    }

    /// Get the data slice
    pub fn getData(self: *const Artwork) []const u8 {
        return self.data[0..self.data_len];
    }

    /// Get the mime type string
    pub fn getMimeType(self: *const Artwork) []const u8 {
        return self.mime_type[0..self.mime_type_len];
    }

    /// Get the source string
    pub fn getSource(self: *const Artwork) []const u8 {
        return self.source[0..self.source_len];
    }

    /// Get the filename if present
    pub fn getFilename(self: *const Artwork) ?[]const u8 {
        if (self.has_filename) {
            return self.filename[0..self.filename_len];
        }
        return null;
    }
};

/// Opaque cache handle for FFI
pub const CacheHandle = opaque {};

/// LRU cache node
const CacheNode = struct {
    track_id: i64,
    artwork: ?Artwork, // None values are cached (important behavior to preserve)
    prev: ?*CacheNode,
    next: ?*CacheNode,
};

/// LRU cache implementation
/// Thread-safe with mutex protection
pub const ArtworkCache = struct {
    allocator: Allocator,
    capacity: usize,
    map: std.AutoHashMap(i64, *CacheNode),
    head: ?*CacheNode, // Most recently used
    tail: ?*CacheNode, // Least recently used
    mutex: std.Thread.Mutex,

    /// Initialize a new artwork cache
    pub fn init(allocator: Allocator, capacity: usize) !*ArtworkCache {
        const cache = try allocator.create(ArtworkCache);
        cache.* = .{
            .allocator = allocator,
            .capacity = if (capacity == 0) DEFAULT_CACHE_SIZE else capacity,
            .map = std.AutoHashMap(i64, *CacheNode).init(allocator),
            .head = null,
            .tail = null,
            .mutex = .{},
        };
        return cache;
    }

    /// Clean up the cache and free all resources
    pub fn deinit(self: *ArtworkCache) void {
        // Lock to ensure no concurrent access
        self.mutex.lock();
        // Note: We don't defer unlock because we're about to destroy self

        // Free all nodes
        var current = self.head;
        while (current) |node| {
            const next = node.next;
            self.allocator.destroy(node);
            current = next;
        }

        // Deinit map and capture allocator before destroying self
        self.map.deinit();
        const allocator = self.allocator;

        // Unlock before destroying (mutex is part of self)
        self.mutex.unlock();

        // Now safe to destroy self
        allocator.destroy(self);
    }

    /// Get artwork for a track, using cache if available
    /// This method caches both Some and None results (important behavior)
    pub fn getOrLoad(self: *ArtworkCache, track_id: i64, filepath: [*:0]const u8) ?Artwork {
        // Phase 1: Check cache (with lock)
        {
            self.mutex.lock();
            defer self.mutex.unlock();

            if (self.map.get(track_id)) |node| {
                // Cache hit - move to front (most recently used)
                self.moveToFrontLocked(node);
                return node.artwork;
            }
        }

        // Phase 2: Load from file (without lock - allows concurrent I/O)
        const artwork = extractArtwork(filepath);

        // Phase 3: Store in cache (with lock)
        {
            self.mutex.lock();
            defer self.mutex.unlock();

            // Double-check if another thread loaded it while we were loading
            if (self.map.get(track_id)) |node| {
                self.moveToFrontLocked(node);
                return node.artwork;
            }

            // Create new node
            const node = self.allocator.create(CacheNode) catch return artwork;
            node.* = .{
                .track_id = track_id,
                .artwork = artwork,
                .prev = null,
                .next = null,
            };

            // Insert at front
            self.insertAtFrontLocked(node);

            // Add to map
            self.map.put(track_id, node) catch {
                // Failed to add to map - remove from list and free
                self.removeFromListLocked(node);
                self.allocator.destroy(node);
                return artwork;
            };

            // Evict LRU if over capacity
            if (self.map.count() > self.capacity) {
                self.evictLRULocked();
            }
        }

        return artwork;
    }

    /// Invalidate cache entry for a specific track
    pub fn invalidate(self: *ArtworkCache, track_id: i64) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        if (self.map.fetchRemove(track_id)) |kv| {
            self.removeFromListLocked(kv.value);
            self.allocator.destroy(kv.value);
        }
    }

    /// Clear all cache entries
    pub fn clear(self: *ArtworkCache) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        // Free all nodes
        var current = self.head;
        while (current) |node| {
            const next = node.next;
            self.allocator.destroy(node);
            current = next;
        }

        self.map.clearAndFree();
        self.head = null;
        self.tail = null;
    }

    /// Get current number of cached items
    pub fn len(self: *ArtworkCache) usize {
        self.mutex.lock();
        defer self.mutex.unlock();
        return self.map.count();
    }

    /// Check if cache is empty
    pub fn isEmpty(self: *ArtworkCache) bool {
        return self.len() == 0;
    }

    // =========================================================================
    // Private helper methods (must be called with mutex held)
    // =========================================================================

    /// Move node to front of linked list (mark as most recently used)
    /// Caller must hold mutex
    fn moveToFrontLocked(self: *ArtworkCache, node: *CacheNode) void {
        if (self.head == node) {
            return; // Already at front
        }

        // Remove from current position
        self.removeFromListLocked(node);

        // Insert at front
        self.insertAtFrontLocked(node);
    }

    /// Insert node at front of linked list
    /// Caller must hold mutex
    fn insertAtFrontLocked(self: *ArtworkCache, node: *CacheNode) void {
        node.prev = null;
        node.next = self.head;

        if (self.head) |head| {
            head.prev = node;
        }
        self.head = node;

        if (self.tail == null) {
            self.tail = node;
        }
    }

    /// Remove node from linked list (doesn't free the node)
    /// Caller must hold mutex
    fn removeFromListLocked(self: *ArtworkCache, node: *CacheNode) void {
        if (node.prev) |prev| {
            prev.next = node.next;
        } else {
            self.head = node.next;
        }

        if (node.next) |next| {
            next.prev = node.prev;
        } else {
            self.tail = node.prev;
        }

        node.prev = null;
        node.next = null;
    }

    /// Remove least recently used node (tail) when at capacity
    /// Caller must hold mutex
    fn evictLRULocked(self: *ArtworkCache) void {
        if (self.tail) |tail| {
            _ = self.map.remove(tail.track_id);
            self.removeFromListLocked(tail);
            self.allocator.destroy(tail);
        }
    }
};

// =============================================================================
// Artwork extraction functions
// =============================================================================

/// Standard folder artwork filenames to search for
const FOLDER_ARTWORK_NAMES = [_][]const u8{
    "cover.jpg",
    "cover.jpeg",
    "cover.png",
    "folder.jpg",
    "folder.jpeg",
    "folder.png",
    "album.jpg",
    "album.jpeg",
    "album.png",
    "front.jpg",
    "front.jpeg",
    "front.png",
};

/// Extract artwork from file (embedded or folder-based)
fn extractArtwork(filepath: [*:0]const u8) ?Artwork {
    // Try embedded artwork first
    if (extractEmbeddedArtwork(filepath)) |artwork| {
        return artwork;
    }

    // Fall back to folder-based artwork
    return extractFolderArtwork(filepath);
}

/// Extract embedded artwork using TagLib C bindings
/// NOTE: Currently returns null - embedded artwork extraction stays in Rust via lofty
/// This is a placeholder for future TagLib C integration
fn extractEmbeddedArtwork(filepath: [*:0]const u8) ?Artwork {
    // NOTE: Per migration plan, metadata/artwork extraction stays in Rust via lofty.
    // This function is a placeholder that returns null.
    // When calling from Rust, use the FFI to call Rust's get_artwork instead.
    _ = filepath;
    return null;
}

/// Find folder-based artwork in same directory
fn extractFolderArtwork(filepath: [*:0]const u8) ?Artwork {
    const path_slice = std.mem.span(filepath);

    // Get directory from filepath
    const dir_path = std.fs.path.dirname(path_slice) orelse return null;

    // Try each standard artwork filename
    for (FOLDER_ARTWORK_NAMES) |artwork_name| {
        var path_buf: [std.fs.max_path_bytes]u8 = undefined;
        const full_path = std.fmt.bufPrint(&path_buf, "{s}/{s}", .{ dir_path, artwork_name }) catch continue;

        // Try to read the file
        const file = std.fs.openFileAbsolute(full_path, .{}) catch continue;
        defer file.close();

        // Read file contents (limit to reasonable size for artwork)
        var data_buf: [8192]u8 = undefined;
        const bytes_read = file.readAll(&data_buf) catch continue;

        if (bytes_read == 0) continue;

        // Determine mime type from extension
        const mime_type = getMimeTypeFromFilename(artwork_name);

        // Create artwork struct
        return Artwork.init(
            data_buf[0..bytes_read],
            mime_type,
            "folder",
            artwork_name,
        );
    }

    return null;
}

/// Get MIME type from filename extension
fn getMimeTypeFromFilename(filename: []const u8) []const u8 {
    if (std.mem.endsWith(u8, filename, ".jpg") or std.mem.endsWith(u8, filename, ".jpeg")) {
        return "image/jpeg";
    } else if (std.mem.endsWith(u8, filename, ".png")) {
        return "image/png";
    }
    return "application/octet-stream";
}

// =============================================================================
// Tests
// =============================================================================

test "ArtworkCache creation" {
    const allocator = std.testing.allocator;

    const cache = try ArtworkCache.init(allocator, DEFAULT_CACHE_SIZE);
    defer cache.deinit();

    try std.testing.expectEqual(@as(usize, 0), cache.len());
    try std.testing.expect(cache.isEmpty());
}

test "ArtworkCache custom capacity" {
    const allocator = std.testing.allocator;

    const cache = try ArtworkCache.init(allocator, 50);
    defer cache.deinit();

    try std.testing.expectEqual(@as(usize, 50), cache.capacity);
    try std.testing.expectEqual(@as(usize, 0), cache.len());
}

test "ArtworkCache caches None results" {
    const allocator = std.testing.allocator;

    const cache = try ArtworkCache.init(allocator, DEFAULT_CACHE_SIZE);
    defer cache.deinit();

    // Load artwork for a non-existent file (will return null)
    const artwork1 = cache.getOrLoad(1, "/nonexistent/path/song.mp3");
    try std.testing.expect(artwork1 == null);

    // Should have cached the None result
    try std.testing.expectEqual(@as(usize, 1), cache.len());

    // Second call should return cached null
    const artwork2 = cache.getOrLoad(1, "/nonexistent/path/song.mp3");
    try std.testing.expect(artwork2 == null);
    try std.testing.expectEqual(@as(usize, 1), cache.len());
}

test "ArtworkCache LRU eviction" {
    const allocator = std.testing.allocator;

    // Create cache with capacity 3
    const cache = try ArtworkCache.init(allocator, 3);
    defer cache.deinit();

    // Add 4 items
    _ = cache.getOrLoad(1, "/path/song1.mp3");
    _ = cache.getOrLoad(2, "/path/song2.mp3");
    _ = cache.getOrLoad(3, "/path/song3.mp3");
    _ = cache.getOrLoad(4, "/path/song4.mp3");

    // Cache should only hold 3 items (LRU evicted the oldest - track 1)
    try std.testing.expectEqual(@as(usize, 3), cache.len());
}

test "ArtworkCache invalidation" {
    const allocator = std.testing.allocator;

    const cache = try ArtworkCache.init(allocator, DEFAULT_CACHE_SIZE);
    defer cache.deinit();

    _ = cache.getOrLoad(1, "/path/song.mp3");
    try std.testing.expectEqual(@as(usize, 1), cache.len());

    cache.invalidate(1);
    try std.testing.expectEqual(@as(usize, 0), cache.len());
}

test "ArtworkCache clear" {
    const allocator = std.testing.allocator;

    const cache = try ArtworkCache.init(allocator, DEFAULT_CACHE_SIZE);
    defer cache.deinit();

    // Add several items
    _ = cache.getOrLoad(1, "/path/song1.mp3");
    _ = cache.getOrLoad(2, "/path/song2.mp3");
    _ = cache.getOrLoad(3, "/path/song3.mp3");
    try std.testing.expectEqual(@as(usize, 3), cache.len());

    cache.clear();
    try std.testing.expectEqual(@as(usize, 0), cache.len());
    try std.testing.expect(cache.isEmpty());
}

test "ArtworkCache LRU ordering" {
    const allocator = std.testing.allocator;

    // Create cache with capacity 3
    const cache = try ArtworkCache.init(allocator, 3);
    defer cache.deinit();

    // Add 3 items
    _ = cache.getOrLoad(1, "/path/song1.mp3");
    _ = cache.getOrLoad(2, "/path/song2.mp3");
    _ = cache.getOrLoad(3, "/path/song3.mp3");

    // Access item 1 again (moves it to front)
    _ = cache.getOrLoad(1, "/path/song1.mp3");

    // Add item 4 - should evict item 2 (oldest after 1 was accessed)
    _ = cache.getOrLoad(4, "/path/song4.mp3");

    try std.testing.expectEqual(@as(usize, 3), cache.len());
}

test "Artwork struct creation" {
    const artwork = Artwork.init(
        "test_data",
        "image/jpeg",
        "folder",
        "cover.jpg",
    );

    try std.testing.expect(artwork != null);

    const art = artwork.?;
    try std.testing.expectEqualStrings("test_data", art.getData());
    try std.testing.expectEqualStrings("image/jpeg", art.getMimeType());
    try std.testing.expectEqualStrings("folder", art.getSource());
    try std.testing.expectEqualStrings("cover.jpg", art.getFilename().?);
}

test "getMimeTypeFromFilename" {
    try std.testing.expectEqualStrings("image/jpeg", getMimeTypeFromFilename("cover.jpg"));
    try std.testing.expectEqualStrings("image/jpeg", getMimeTypeFromFilename("cover.jpeg"));
    try std.testing.expectEqualStrings("image/png", getMimeTypeFromFilename("cover.png"));
    try std.testing.expectEqualStrings("application/octet-stream", getMimeTypeFromFilename("cover.gif"));
}
