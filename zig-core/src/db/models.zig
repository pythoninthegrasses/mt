//! Database models and schema definitions.
//!
//! Defines all database tables and their corresponding Zig structs.
//! Schema matches the Rust backend schema.rs exactly.

const std = @import("std");

// =============================================================================
// Model Structs (FFI-safe with fixed-size buffers)
// =============================================================================

/// Track/Library model - represents a music file in the library
pub const Track = extern struct {
    id: i64,
    filepath: [4096]u8,
    filepath_len: u32,
    title: [512]u8,
    title_len: u32,
    artist: [512]u8,
    artist_len: u32,
    album: [512]u8,
    album_len: u32,
    album_artist: [512]u8,
    album_artist_len: u32,
    track_number: [32]u8,
    track_number_len: u32,
    track_total: [32]u8,
    track_total_len: u32,
    date: [32]u8,
    date_len: u32,
    genre: [256]u8,
    genre_len: u32,
    duration_secs: f64,
    file_size: i64,
    file_mtime_ns: i64,
    file_inode: i64,
    content_hash: [64]u8, // SHA256 hex
    content_hash_len: u32,
    added_date: i64,
    last_played: i64,
    play_count: u32,
    lastfm_loved: bool,
    missing: bool,
    last_seen_at: i64,

    /// Initialize an empty track
    pub fn init() Track {
        var track = Track{
            .id = 0,
            .filepath = undefined,
            .filepath_len = 0,
            .title = undefined,
            .title_len = 0,
            .artist = undefined,
            .artist_len = 0,
            .album = undefined,
            .album_len = 0,
            .album_artist = undefined,
            .album_artist_len = 0,
            .track_number = undefined,
            .track_number_len = 0,
            .track_total = undefined,
            .track_total_len = 0,
            .date = undefined,
            .date_len = 0,
            .genre = undefined,
            .genre_len = 0,
            .duration_secs = 0.0,
            .file_size = 0,
            .file_mtime_ns = 0,
            .file_inode = 0,
            .content_hash = undefined,
            .content_hash_len = 0,
            .added_date = 0,
            .last_played = 0,
            .play_count = 0,
            .lastfm_loved = false,
            .missing = false,
            .last_seen_at = 0,
        };
        @memset(&track.filepath, 0);
        @memset(&track.title, 0);
        @memset(&track.artist, 0);
        @memset(&track.album, 0);
        @memset(&track.album_artist, 0);
        @memset(&track.track_number, 0);
        @memset(&track.track_total, 0);
        @memset(&track.date, 0);
        @memset(&track.genre, 0);
        @memset(&track.content_hash, 0);
        return track;
    }

    /// Get filepath as slice
    pub fn getFilepath(self: *const Track) []const u8 {
        return self.filepath[0..self.filepath_len];
    }

    /// Get title as slice
    pub fn getTitle(self: *const Track) []const u8 {
        return self.title[0..self.title_len];
    }

    /// Get artist as slice
    pub fn getArtist(self: *const Track) []const u8 {
        return self.artist[0..self.artist_len];
    }

    /// Get album as slice
    pub fn getAlbum(self: *const Track) []const u8 {
        return self.album[0..self.album_len];
    }

    /// Set filepath
    pub fn setFilepath(self: *Track, path: []const u8) void {
        const len = @min(path.len, self.filepath.len);
        @memcpy(self.filepath[0..len], path[0..len]);
        self.filepath_len = @intCast(len);
    }

    /// Set title
    pub fn setTitle(self: *Track, value: []const u8) void {
        const len = @min(value.len, self.title.len);
        @memcpy(self.title[0..len], value[0..len]);
        self.title_len = @intCast(len);
    }

    /// Set artist
    pub fn setArtist(self: *Track, value: []const u8) void {
        const len = @min(value.len, self.artist.len);
        @memcpy(self.artist[0..len], value[0..len]);
        self.artist_len = @intCast(len);
    }

    /// Set album
    pub fn setAlbum(self: *Track, value: []const u8) void {
        const len = @min(value.len, self.album.len);
        @memcpy(self.album[0..len], value[0..len]);
        self.album_len = @intCast(len);
    }
};

/// Playlist model
pub const Playlist = extern struct {
    id: i64,
    name: [512]u8,
    name_len: u32,
    position: u32,
    created_at: i64,

    /// Initialize an empty playlist
    pub fn init() Playlist {
        var playlist = Playlist{
            .id = 0,
            .name = undefined,
            .name_len = 0,
            .position = 0,
            .created_at = 0,
        };
        @memset(&playlist.name, 0);
        return playlist;
    }

    /// Get name as slice
    pub fn getName(self: *const Playlist) []const u8 {
        return self.name[0..self.name_len];
    }

    /// Set name
    pub fn setName(self: *Playlist, value: []const u8) void {
        const len = @min(value.len, self.name.len);
        @memcpy(self.name[0..len], value[0..len]);
        self.name_len = @intCast(len);
    }
};

/// Playlist item model (track in a playlist)
pub const PlaylistItem = extern struct {
    id: i64,
    playlist_id: i64,
    track_id: i64,
    position: u32,
    added_at: i64,
};

/// Queue item model (track in the play queue)
pub const QueueItem = extern struct {
    id: i64,
    filepath: [4096]u8,
    filepath_len: u32,

    /// Initialize an empty queue item
    pub fn init() QueueItem {
        var item = QueueItem{
            .id = 0,
            .filepath = undefined,
            .filepath_len = 0,
        };
        @memset(&item.filepath, 0);
        return item;
    }

    /// Get filepath as slice
    pub fn getFilepath(self: *const QueueItem) []const u8 {
        return self.filepath[0..self.filepath_len];
    }

    /// Set filepath
    pub fn setFilepath(self: *QueueItem, path: []const u8) void {
        const len = @min(path.len, self.filepath.len);
        @memcpy(self.filepath[0..len], path[0..len]);
        self.filepath_len = @intCast(len);
    }
};

/// Queue state model (singleton - stores playback state)
pub const QueueState = extern struct {
    current_index: i32,
    shuffle_enabled: bool,
    loop_mode: [16]u8,
    loop_mode_len: u32,
    original_order_json: [65536]u8, // Large buffer for JSON array
    original_order_json_len: u32,

    /// Initialize default queue state
    pub fn init() QueueState {
        var state = QueueState{
            .current_index = -1,
            .shuffle_enabled = false,
            .loop_mode = undefined,
            .loop_mode_len = 4,
            .original_order_json = undefined,
            .original_order_json_len = 0,
        };
        @memset(&state.loop_mode, 0);
        @memcpy(state.loop_mode[0..4], "none");
        @memset(&state.original_order_json, 0);
        return state;
    }

    /// Get loop mode as slice
    pub fn getLoopMode(self: *const QueueState) []const u8 {
        return self.loop_mode[0..self.loop_mode_len];
    }
};

/// Setting model (key-value store)
pub const Setting = extern struct {
    key: [256]u8,
    key_len: u32,
    value: [4096]u8,
    value_len: u32,

    /// Initialize an empty setting
    pub fn init() Setting {
        var setting = Setting{
            .key = undefined,
            .key_len = 0,
            .value = undefined,
            .value_len = 0,
        };
        @memset(&setting.key, 0);
        @memset(&setting.value, 0);
        return setting;
    }

    /// Get key as slice
    pub fn getKey(self: *const Setting) []const u8 {
        return self.key[0..self.key_len];
    }

    /// Get value as slice
    pub fn getValue(self: *const Setting) []const u8 {
        return self.value[0..self.value_len];
    }
};

/// Favorite model
pub const Favorite = extern struct {
    id: i64,
    track_id: i64,
    timestamp: i64,
};

/// Lyrics cache model
pub const LyricsCache = extern struct {
    id: i64,
    artist: [512]u8,
    artist_len: u32,
    title: [512]u8,
    title_len: u32,
    album: [512]u8,
    album_len: u32,
    lyrics: [65536]u8, // Large buffer for lyrics text
    lyrics_len: u32,
    source_url: [2048]u8,
    source_url_len: u32,
    fetched_at: i64,

    /// Initialize an empty lyrics cache entry
    pub fn init() LyricsCache {
        var cache = LyricsCache{
            .id = 0,
            .artist = undefined,
            .artist_len = 0,
            .title = undefined,
            .title_len = 0,
            .album = undefined,
            .album_len = 0,
            .lyrics = undefined,
            .lyrics_len = 0,
            .source_url = undefined,
            .source_url_len = 0,
            .fetched_at = 0,
        };
        @memset(&cache.artist, 0);
        @memset(&cache.title, 0);
        @memset(&cache.album, 0);
        @memset(&cache.lyrics, 0);
        @memset(&cache.source_url, 0);
        return cache;
    }
};

/// Scrobble queue entry (for offline scrobbling)
pub const ScrobbleEntry = extern struct {
    id: i64,
    artist: [512]u8,
    artist_len: u32,
    track: [512]u8,
    track_len: u32,
    album: [512]u8,
    album_len: u32,
    timestamp: i64,
    created_at: i64,
    retry_count: u32,

    /// Initialize an empty scrobble entry
    pub fn init() ScrobbleEntry {
        var entry = ScrobbleEntry{
            .id = 0,
            .artist = undefined,
            .artist_len = 0,
            .track = undefined,
            .track_len = 0,
            .album = undefined,
            .album_len = 0,
            .timestamp = 0,
            .created_at = 0,
            .retry_count = 0,
        };
        @memset(&entry.artist, 0);
        @memset(&entry.track, 0);
        @memset(&entry.album, 0);
        return entry;
    }
};

/// Watched folder model
pub const WatchedFolder = extern struct {
    id: i64,
    path: [4096]u8,
    path_len: u32,
    mode: [32]u8, // "startup", "realtime", "manual"
    mode_len: u32,
    cadence_minutes: u32,
    enabled: bool,
    last_scanned_at: i64,
    created_at: i64,
    updated_at: i64,

    /// Initialize an empty watched folder
    pub fn init() WatchedFolder {
        var folder = WatchedFolder{
            .id = 0,
            .path = undefined,
            .path_len = 0,
            .mode = undefined,
            .mode_len = 7,
            .cadence_minutes = 10,
            .enabled = true,
            .last_scanned_at = 0,
            .created_at = 0,
            .updated_at = 0,
        };
        @memset(&folder.path, 0);
        @memset(&folder.mode, 0);
        @memcpy(folder.mode[0..7], "startup");
        return folder;
    }

    /// Get path as slice
    pub fn getPath(self: *const WatchedFolder) []const u8 {
        return self.path[0..self.path_len];
    }

    /// Get mode as slice
    pub fn getMode(self: *const WatchedFolder) []const u8 {
        return self.mode[0..self.mode_len];
    }
};

// =============================================================================
// Schema Definitions
// =============================================================================

/// Schema version for migrations
pub const SCHEMA_VERSION: u32 = 1;

/// SQL schema definitions matching Rust's CREATE_TABLES exactly
pub const SCHEMA_SQL = struct {
    /// Queue table - simple filepath-based queue
    pub const queue_table =
        \\CREATE TABLE IF NOT EXISTS queue (
        \\    id INTEGER PRIMARY KEY AUTOINCREMENT,
        \\    filepath TEXT NOT NULL
        \\);
    ;

    /// Library table - main track storage
    pub const library_table =
        \\CREATE TABLE IF NOT EXISTS library (
        \\    id INTEGER PRIMARY KEY AUTOINCREMENT,
        \\    filepath TEXT NOT NULL,
        \\    title TEXT,
        \\    artist TEXT,
        \\    album TEXT,
        \\    album_artist TEXT,
        \\    track_number TEXT,
        \\    track_total TEXT,
        \\    date TEXT,
        \\    duration REAL,
        \\    file_size INTEGER DEFAULT 0,
        \\    file_mtime_ns INTEGER,
        \\    added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \\    last_played TIMESTAMP,
        \\    play_count INTEGER DEFAULT 0
        \\);
    ;

    /// Settings table - key-value store
    pub const settings_table =
        \\CREATE TABLE IF NOT EXISTS settings (
        \\    key TEXT PRIMARY KEY,
        \\    value TEXT
        \\);
    ;

    /// Favorites table - track favorites
    pub const favorites_table =
        \\CREATE TABLE IF NOT EXISTS favorites (
        \\    id INTEGER PRIMARY KEY AUTOINCREMENT,
        \\    track_id INTEGER NOT NULL,
        \\    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \\    FOREIGN KEY (track_id) REFERENCES library(id),
        \\    UNIQUE(track_id)
        \\);
    ;

    /// Lyrics cache table
    pub const lyrics_cache_table =
        \\CREATE TABLE IF NOT EXISTS lyrics_cache (
        \\    id INTEGER PRIMARY KEY AUTOINCREMENT,
        \\    artist TEXT NOT NULL,
        \\    title TEXT NOT NULL,
        \\    album TEXT,
        \\    lyrics TEXT,
        \\    source_url TEXT,
        \\    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \\    UNIQUE(artist, title)
        \\);
    ;

    /// Playlists table
    pub const playlists_table =
        \\CREATE TABLE IF NOT EXISTS playlists (
        \\    id INTEGER PRIMARY KEY AUTOINCREMENT,
        \\    name TEXT NOT NULL UNIQUE,
        \\    position INTEGER DEFAULT 0,
        \\    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        \\);
    ;

    /// Playlist items table
    pub const playlist_items_table =
        \\CREATE TABLE IF NOT EXISTS playlist_items (
        \\    id INTEGER PRIMARY KEY AUTOINCREMENT,
        \\    playlist_id INTEGER NOT NULL,
        \\    track_id INTEGER NOT NULL,
        \\    position INTEGER NOT NULL,
        \\    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \\    UNIQUE(playlist_id, track_id),
        \\    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
        \\    FOREIGN KEY (track_id) REFERENCES library(id) ON DELETE CASCADE
        \\);
    ;

    /// Scrobble queue table
    pub const scrobble_queue_table =
        \\CREATE TABLE IF NOT EXISTS scrobble_queue (
        \\    id INTEGER PRIMARY KEY AUTOINCREMENT,
        \\    artist TEXT NOT NULL,
        \\    track TEXT NOT NULL,
        \\    album TEXT,
        \\    timestamp INTEGER NOT NULL,
        \\    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \\    retry_count INTEGER DEFAULT 0
        \\);
    ;

    /// Watched folders table
    pub const watched_folders_table =
        \\CREATE TABLE IF NOT EXISTS watched_folders (
        \\    id INTEGER PRIMARY KEY AUTOINCREMENT,
        \\    path TEXT NOT NULL UNIQUE,
        \\    mode TEXT NOT NULL DEFAULT 'startup',
        \\    cadence_minutes INTEGER DEFAULT 10,
        \\    enabled INTEGER NOT NULL DEFAULT 1,
        \\    last_scanned_at INTEGER,
        \\    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        \\    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        \\);
    ;

    /// Queue state table (singleton)
    pub const queue_state_table =
        \\CREATE TABLE IF NOT EXISTS queue_state (
        \\    id INTEGER PRIMARY KEY CHECK (id = 1),
        \\    current_index INTEGER DEFAULT -1,
        \\    shuffle_enabled INTEGER DEFAULT 0,
        \\    loop_mode TEXT DEFAULT 'none',
        \\    original_order_json TEXT
        \\);
    ;

    /// All table schemas in order
    pub const all_tables = [_][]const u8{
        queue_table,
        library_table,
        settings_table,
        favorites_table,
        lyrics_cache_table,
        playlists_table,
        playlist_items_table,
        scrobble_queue_table,
        watched_folders_table,
        queue_state_table,
    };

    /// Index creation statements
    pub const indices = struct {
        pub const library_filepath =
            \\CREATE INDEX IF NOT EXISTS idx_library_filepath ON library(filepath);
        ;
        pub const library_file_inode =
            \\CREATE INDEX IF NOT EXISTS idx_library_file_inode ON library(file_inode) WHERE file_inode IS NOT NULL;
        ;
        pub const library_content_hash =
            \\CREATE INDEX IF NOT EXISTS idx_library_content_hash ON library(content_hash) WHERE content_hash IS NOT NULL;
        ;
    };

    /// Migration SQL for adding columns
    pub const migrations = struct {
        pub const add_file_size = "ALTER TABLE library ADD COLUMN file_size INTEGER DEFAULT 0";
        pub const add_file_mtime_ns = "ALTER TABLE library ADD COLUMN file_mtime_ns INTEGER";
        pub const add_lastfm_loved = "ALTER TABLE library ADD COLUMN lastfm_loved BOOLEAN DEFAULT FALSE";
        pub const add_missing = "ALTER TABLE library ADD COLUMN missing INTEGER DEFAULT 0";
        pub const add_last_seen_at = "ALTER TABLE library ADD COLUMN last_seen_at INTEGER";
        pub const add_file_inode = "ALTER TABLE library ADD COLUMN file_inode INTEGER";
        pub const add_content_hash = "ALTER TABLE library ADD COLUMN content_hash TEXT";
        pub const add_playlist_position = "ALTER TABLE playlists ADD COLUMN position INTEGER DEFAULT 0";
    };
};

// =============================================================================
// Tests
// =============================================================================

test "Track struct initialization" {
    const track = Track.init();
    try std.testing.expectEqual(@as(i64, 0), track.id);
    try std.testing.expectEqual(@as(u32, 0), track.filepath_len);
    try std.testing.expectEqual(@as(u32, 0), track.title_len);
    try std.testing.expectEqual(@as(f64, 0.0), track.duration_secs);
    try std.testing.expect(!track.missing);
    try std.testing.expect(!track.lastfm_loved);
}

test "Track setters and getters" {
    var track = Track.init();

    track.setFilepath("/music/test.mp3");
    try std.testing.expectEqualStrings("/music/test.mp3", track.getFilepath());

    track.setTitle("Test Song");
    try std.testing.expectEqualStrings("Test Song", track.getTitle());

    track.setArtist("Test Artist");
    try std.testing.expectEqualStrings("Test Artist", track.getArtist());

    track.setAlbum("Test Album");
    try std.testing.expectEqualStrings("Test Album", track.getAlbum());
}

test "Playlist initialization and setters" {
    var playlist = Playlist.init();
    try std.testing.expectEqual(@as(i64, 0), playlist.id);
    try std.testing.expectEqual(@as(u32, 0), playlist.position);

    playlist.setName("My Playlist");
    try std.testing.expectEqualStrings("My Playlist", playlist.getName());
}

test "QueueItem initialization" {
    var item = QueueItem.init();
    try std.testing.expectEqual(@as(i64, 0), item.id);

    item.setFilepath("/music/song.flac");
    try std.testing.expectEqualStrings("/music/song.flac", item.getFilepath());
}

test "QueueState initialization" {
    const state = QueueState.init();
    try std.testing.expectEqual(@as(i32, -1), state.current_index);
    try std.testing.expect(!state.shuffle_enabled);
    try std.testing.expectEqualStrings("none", state.getLoopMode());
}

test "Setting initialization" {
    const setting = Setting.init();
    try std.testing.expectEqual(@as(u32, 0), setting.key_len);
    try std.testing.expectEqual(@as(u32, 0), setting.value_len);
}

test "WatchedFolder initialization" {
    const folder = WatchedFolder.init();
    try std.testing.expect(folder.enabled);
    try std.testing.expectEqual(@as(u32, 10), folder.cadence_minutes);
    try std.testing.expectEqualStrings("startup", folder.getMode());
}

test "ScrobbleEntry initialization" {
    const entry = ScrobbleEntry.init();
    try std.testing.expectEqual(@as(i64, 0), entry.id);
    try std.testing.expectEqual(@as(u32, 0), entry.retry_count);
}

test "Schema SQL table count" {
    // Should have exactly 10 tables matching Rust
    try std.testing.expectEqual(@as(usize, 10), SCHEMA_SQL.all_tables.len);
}

test "Schema SQL validity - basic syntax check" {
    // Verify all SQL strings contain expected keywords
    for (SCHEMA_SQL.all_tables) |sql| {
        try std.testing.expect(std.mem.indexOf(u8, sql, "CREATE TABLE") != null);
        try std.testing.expect(std.mem.indexOf(u8, sql, "IF NOT EXISTS") != null);
    }
}

test "Track struct size is reasonable for FFI" {
    // Track should be large but under 64KB for stack allocation
    const size = @sizeOf(Track);
    try std.testing.expect(size < 65536);
    try std.testing.expect(size > 1000); // Should be reasonably large
}

test "LyricsCache struct initialization" {
    const cache = LyricsCache.init();
    try std.testing.expectEqual(@as(i64, 0), cache.id);
    try std.testing.expectEqual(@as(u32, 0), cache.artist_len);
    try std.testing.expectEqual(@as(u32, 0), cache.lyrics_len);
}
