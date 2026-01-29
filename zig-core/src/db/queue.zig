//! Queue database operations.
//!
//! Manages playback queue, playlists, and favorites.
//! Actual SQLite operations are handled by Rust via FFI - this module
//! provides types and interfaces for cross-language communication.

const std = @import("std");
const models = @import("models.zig");
const Allocator = std.mem.Allocator;

// =============================================================================
// Queue Item Types (FFI-safe)
// =============================================================================

/// Queue item with track reference
pub const QueueItemFull = extern struct {
    id: i64,
    track_id: i64,
    position: u32,
    is_current: bool,
    added_at: i64, // Unix timestamp

    pub fn init() QueueItemFull {
        return QueueItemFull{
            .id = 0,
            .track_id = 0,
            .position = 0,
            .is_current = false,
            .added_at = 0,
        };
    }
};

/// Queue state snapshot
pub const QueueSnapshot = extern struct {
    current_position: u32,
    total_items: u32,
    shuffle_enabled: bool,
    repeat_mode: RepeatMode,
    current_track_id: i64,

    pub const RepeatMode = enum(u8) {
        off = 0,
        one = 1,
        all = 2,
    };

    pub fn init() QueueSnapshot {
        return QueueSnapshot{
            .current_position = 0,
            .total_items = 0,
            .shuffle_enabled = false,
            .repeat_mode = .off,
            .current_track_id = 0,
        };
    }
};

// =============================================================================
// Queue Results (FFI-safe)
// =============================================================================

/// Result of queue query
pub const QueueQueryResult = extern struct {
    items_ptr: ?[*]QueueItemFull,
    count: u32,
    error_code: u32,

    pub fn initSuccess(items: []QueueItemFull) QueueQueryResult {
        return QueueQueryResult{
            .items_ptr = if (items.len > 0) items.ptr else null,
            .count = @intCast(items.len),
            .error_code = 0,
        };
    }

    pub fn initEmpty() QueueQueryResult {
        return QueueQueryResult{
            .items_ptr = null,
            .count = 0,
            .error_code = 0,
        };
    }

    pub fn initError(code: u32) QueueQueryResult {
        return QueueQueryResult{
            .items_ptr = null,
            .count = 0,
            .error_code = code,
        };
    }

    pub fn isSuccess(self: *const QueueQueryResult) bool {
        return self.error_code == 0;
    }

    pub fn getItems(self: *const QueueQueryResult) []QueueItemFull {
        if (self.items_ptr) |ptr| {
            return ptr[0..self.count];
        }
        return &[_]QueueItemFull{};
    }
};

// =============================================================================
// Playlist Types (FFI-safe)
// =============================================================================

/// Playlist metadata
pub const PlaylistInfo = extern struct {
    id: i64,
    name: [256]u8,
    name_len: u32,
    track_count: u32,
    total_duration: i64, // Total duration in seconds
    created_at: i64,
    updated_at: i64,

    pub fn init() PlaylistInfo {
        var info = PlaylistInfo{
            .id = 0,
            .name = undefined,
            .name_len = 0,
            .track_count = 0,
            .total_duration = 0,
            .created_at = 0,
            .updated_at = 0,
        };
        @memset(&info.name, 0);
        return info;
    }

    pub fn getName(self: *const PlaylistInfo) []const u8 {
        return self.name[0..self.name_len];
    }

    pub fn setName(self: *PlaylistInfo, n: []const u8) void {
        const len = @min(n.len, self.name.len);
        @memcpy(self.name[0..len], n[0..len]);
        self.name_len = @intCast(len);
    }
};

/// Playlist query result
pub const PlaylistQueryResult = extern struct {
    playlists_ptr: ?[*]PlaylistInfo,
    count: u32,
    error_code: u32,

    pub fn initSuccess(playlists: []PlaylistInfo) PlaylistQueryResult {
        return PlaylistQueryResult{
            .playlists_ptr = if (playlists.len > 0) playlists.ptr else null,
            .count = @intCast(playlists.len),
            .error_code = 0,
        };
    }

    pub fn initEmpty() PlaylistQueryResult {
        return PlaylistQueryResult{
            .playlists_ptr = null,
            .count = 0,
            .error_code = 0,
        };
    }

    pub fn initError(code: u32) PlaylistQueryResult {
        return PlaylistQueryResult{
            .playlists_ptr = null,
            .count = 0,
            .error_code = code,
        };
    }

    pub fn isSuccess(self: *const PlaylistQueryResult) bool {
        return self.error_code == 0;
    }

    pub fn getPlaylists(self: *const PlaylistQueryResult) []PlaylistInfo {
        if (self.playlists_ptr) |ptr| {
            return ptr[0..self.count];
        }
        return &[_]PlaylistInfo{};
    }
};

// =============================================================================
// Queue Manager
// =============================================================================

/// Queue manager - handles queue operations
pub const QueueManager = struct {
    allocator: Allocator,
    state: QueueSnapshot,

    pub fn init(allocator: Allocator) QueueManager {
        return QueueManager{
            .allocator = allocator,
            .state = QueueSnapshot.init(),
        };
    }

    /// Calculate new positions when moving an item
    pub fn calculateMovePositions(
        self: *QueueManager,
        from_pos: u32,
        to_pos: u32,
        total_items: u32,
    ) MoveResult {
        _ = self;

        if (from_pos >= total_items or to_pos >= total_items) {
            return MoveResult.initError(1); // Invalid position
        }

        if (from_pos == to_pos) {
            return MoveResult.initNoOp();
        }

        return MoveResult{
            .from_position = from_pos,
            .to_position = to_pos,
            .shift_start = @min(from_pos, to_pos),
            .shift_end = @max(from_pos, to_pos),
            .shift_direction = if (from_pos < to_pos) .down else .up,
            .error_code = 0,
        };
    }

    /// Build shuffle order using Fisher-Yates algorithm
    pub fn buildShuffleOrder(
        self: *QueueManager,
        count: u32,
        current_position: u32,
        random_seed: u64,
    ) ![]u32 {
        if (count == 0) {
            return &[_]u32{};
        }

        var order = try self.allocator.alloc(u32, count);
        errdefer self.allocator.free(order);

        // Initialize with sequential positions
        for (0..count) |i| {
            order[i] = @intCast(i);
        }

        // Keep current at position 0, shuffle the rest
        if (current_position < count) {
            std.mem.swap(u32, &order[0], &order[current_position]);
        }

        // Fisher-Yates shuffle starting from index 1
        var rng = std.Random.DefaultPrng.init(random_seed);
        const random = rng.random();

        var i: u32 = count - 1;
        while (i > 1) : (i -= 1) {
            const j = random.intRangeAtMost(u32, 1, i);
            std.mem.swap(u32, &order[i], &order[j]);
        }

        return order;
    }
};

pub const MoveResult = struct {
    from_position: u32,
    to_position: u32,
    shift_start: u32,
    shift_end: u32,
    shift_direction: ShiftDirection,
    error_code: u32,

    pub const ShiftDirection = enum(u8) {
        none = 0,
        up = 1, // Positions decrease
        down = 2, // Positions increase
    };

    pub fn initNoOp() MoveResult {
        return MoveResult{
            .from_position = 0,
            .to_position = 0,
            .shift_start = 0,
            .shift_end = 0,
            .shift_direction = .none,
            .error_code = 0,
        };
    }

    pub fn initError(code: u32) MoveResult {
        return MoveResult{
            .from_position = 0,
            .to_position = 0,
            .shift_start = 0,
            .shift_end = 0,
            .shift_direction = .none,
            .error_code = code,
        };
    }

    pub fn isSuccess(self: *const MoveResult) bool {
        return self.error_code == 0;
    }
};

// =============================================================================
// Favorites Types (FFI-safe)
// =============================================================================

/// Favorite entry
pub const FavoriteEntry = extern struct {
    id: i64,
    track_id: i64,
    added_at: i64,

    pub fn init() FavoriteEntry {
        return FavoriteEntry{
            .id = 0,
            .track_id = 0,
            .added_at = 0,
        };
    }
};

/// Favorites query result
pub const FavoritesQueryResult = extern struct {
    favorites_ptr: ?[*]FavoriteEntry,
    count: u32,
    error_code: u32,

    pub fn initSuccess(favorites: []FavoriteEntry) FavoritesQueryResult {
        return FavoritesQueryResult{
            .favorites_ptr = if (favorites.len > 0) favorites.ptr else null,
            .count = @intCast(favorites.len),
            .error_code = 0,
        };
    }

    pub fn initEmpty() FavoritesQueryResult {
        return FavoritesQueryResult{
            .favorites_ptr = null,
            .count = 0,
            .error_code = 0,
        };
    }

    pub fn initError(code: u32) FavoritesQueryResult {
        return FavoritesQueryResult{
            .favorites_ptr = null,
            .count = 0,
            .error_code = code,
        };
    }

    pub fn isSuccess(self: *const FavoritesQueryResult) bool {
        return self.error_code == 0;
    }
};

// =============================================================================
// Tests
// =============================================================================

test "QueueItemFull initialization" {
    const item = QueueItemFull.init();
    try std.testing.expectEqual(@as(i64, 0), item.id);
    try std.testing.expectEqual(@as(u32, 0), item.position);
    try std.testing.expect(!item.is_current);
}

test "QueueSnapshot initialization" {
    const snapshot = QueueSnapshot.init();
    try std.testing.expectEqual(@as(u32, 0), snapshot.current_position);
    try std.testing.expect(!snapshot.shuffle_enabled);
    try std.testing.expectEqual(QueueSnapshot.RepeatMode.off, snapshot.repeat_mode);
}

test "QueueQueryResult success" {
    var items: [3]QueueItemFull = undefined;
    for (0..3) |i| {
        items[i] = QueueItemFull.init();
        items[i].position = @intCast(i);
    }

    const result = QueueQueryResult.initSuccess(&items);
    try std.testing.expect(result.isSuccess());
    try std.testing.expectEqual(@as(u32, 3), result.count);
}

test "QueueQueryResult empty" {
    const result = QueueQueryResult.initEmpty();
    try std.testing.expect(result.isSuccess());
    try std.testing.expectEqual(@as(u32, 0), result.count);
}

test "PlaylistInfo initialization" {
    const info = PlaylistInfo.init();
    try std.testing.expectEqual(@as(u32, 0), info.name_len);
    try std.testing.expectEqual(@as(u32, 0), info.track_count);
}

test "PlaylistInfo setName" {
    var info = PlaylistInfo.init();
    info.setName("My Playlist");
    try std.testing.expectEqualStrings("My Playlist", info.getName());
}

test "PlaylistQueryResult success" {
    var playlists: [2]PlaylistInfo = undefined;
    playlists[0] = PlaylistInfo.init();
    playlists[0].setName("Playlist 1");
    playlists[1] = PlaylistInfo.init();
    playlists[1].setName("Playlist 2");

    const result = PlaylistQueryResult.initSuccess(&playlists);
    try std.testing.expect(result.isSuccess());
    try std.testing.expectEqual(@as(u32, 2), result.count);
}

test "QueueManager calculateMovePositions same position" {
    const allocator = std.testing.allocator;
    var manager = QueueManager.init(allocator);

    const result = manager.calculateMovePositions(3, 3, 10);
    try std.testing.expect(result.isSuccess());
    try std.testing.expectEqual(MoveResult.ShiftDirection.none, result.shift_direction);
}

test "QueueManager calculateMovePositions forward" {
    const allocator = std.testing.allocator;
    var manager = QueueManager.init(allocator);

    const result = manager.calculateMovePositions(2, 5, 10);
    try std.testing.expect(result.isSuccess());
    try std.testing.expectEqual(@as(u32, 2), result.shift_start);
    try std.testing.expectEqual(@as(u32, 5), result.shift_end);
    try std.testing.expectEqual(MoveResult.ShiftDirection.down, result.shift_direction);
}

test "QueueManager calculateMovePositions backward" {
    const allocator = std.testing.allocator;
    var manager = QueueManager.init(allocator);

    const result = manager.calculateMovePositions(7, 3, 10);
    try std.testing.expect(result.isSuccess());
    try std.testing.expectEqual(@as(u32, 3), result.shift_start);
    try std.testing.expectEqual(@as(u32, 7), result.shift_end);
    try std.testing.expectEqual(MoveResult.ShiftDirection.up, result.shift_direction);
}

test "QueueManager calculateMovePositions invalid" {
    const allocator = std.testing.allocator;
    var manager = QueueManager.init(allocator);

    const result = manager.calculateMovePositions(15, 3, 10);
    try std.testing.expect(!result.isSuccess());
}

test "QueueManager buildShuffleOrder" {
    const allocator = std.testing.allocator;
    var manager = QueueManager.init(allocator);

    const order = try manager.buildShuffleOrder(5, 2, 12345);
    defer allocator.free(order);

    // Current position (2) should be at index 0 after shuffle
    try std.testing.expectEqual(@as(u32, 2), order[0]);

    // All positions should be present
    var seen = [_]bool{false} ** 5;
    for (order) |pos| {
        seen[pos] = true;
    }
    for (seen) |s| {
        try std.testing.expect(s);
    }
}

test "FavoriteEntry initialization" {
    const entry = FavoriteEntry.init();
    try std.testing.expectEqual(@as(i64, 0), entry.id);
    try std.testing.expectEqual(@as(i64, 0), entry.track_id);
}

test "FavoritesQueryResult success" {
    var favorites: [2]FavoriteEntry = undefined;
    favorites[0] = FavoriteEntry.init();
    favorites[0].track_id = 100;
    favorites[1] = FavoriteEntry.init();
    favorites[1].track_id = 200;

    const result = FavoritesQueryResult.initSuccess(&favorites);
    try std.testing.expect(result.isSuccess());
    try std.testing.expectEqual(@as(u32, 2), result.count);
}
