# FastAPI PEX Sidecar to Rust Backend Migration Analysis

> **HISTORICAL**: This migration is complete. The Python/FastAPI backend has been fully removed. This document is preserved as historical context for the design decisions made during migration.

**Date**: 2026-01-21
**Task**: task-172
**Status**: Migration Complete

## Executive Summary

This document analyzes the current FastAPI PEX sidecar implementation and provides a detailed roadmap for migrating functionality to the Rust backend. The analysis prioritizes migration opportunities by impact and complexity, identifies dependencies, and recommends a phased approach to minimize risk.

### Current Architecture

The mt music player currently uses a hybrid architecture:

- **Frontend**: Tauri webview with basecoat/Alpine.js
- **Backend**: Python FastAPI sidecar packaged as PEX executable
- **Audio**: Rust Tauri backend for playback
- **Database**: SQLite (shared between Python and Rust)

### Migration Goals

1. **Eliminate Python dependency**: Remove PEX sidecar to simplify deployment
2. **Improve performance**: Rust native implementation for better speed and memory usage
3. **Reduce attack surface**: Single-language backend reduces security considerations
4. **Simplify maintenance**: Unified codebase in Rust

---

## Codebase Inventory

### Backend Structure (1,347 total lines)

```text
backend/
├── main.py (120 lines) - FastAPI app initialization
├── models/ (8 files) - Pydantic models for API types
├── routes/ (9 files, 1,347 lines total)
│   ├── library.py (292 lines) - Library management
│   ├── lastfm.py (360 lines) - Last.fm integration
│   ├── websocket.py (140 lines) - Real-time events
│   ├── queue.py (126 lines) - Queue management
│   ├── playlists.py (150 lines) - Playlist CRUD
│   ├── favorites.py (86 lines) - Favorites management
│   ├── watched_folders.py (118 lines) - Folder monitoring
│   └── settings.py (56 lines) - Settings management
└── services/ (4 files)
    ├── database.py (1,502 lines) - SQLite operations
    ├── scanner.py (189 lines) - Metadata extraction
    ├── scanner_2phase.py - Optimized scanning
    ├── lastfm.py - Last.fm API client
    └── artwork.py - Album artwork extraction
```

---

## Detailed Component Analysis

### 1. Database Operations and Schema

**File**: `backend/services/database.py` (1,502 lines)
**Impact**: **HIGH** - Core data layer for all operations
**Complexity**: **MEDIUM-HIGH**
**Dependencies**: All API routes depend on this

#### Current Implementation

- SQLite with context managers and connection pooling
- 9 tables: library, queue, playlists, playlist_items, favorites, settings, scrobble_queue, watched_folders, lyrics_cache
- Built-in migration system
- PRAGMA optimizations (WAL mode, foreign keys, 64MB cache)
- Comprehensive CRUD operations with bulk support
- File fingerprinting (mtime_ns, file_size) for change detection

#### Schema Tables

| Table | Purpose | Columns | Foreign Keys |
|-------|---------|---------|--------------|
| `library` | Track metadata | 18 columns (filepath, title, artist, album, duration, etc.) | None |
| `queue` | Playback queue | id, filepath | None |
| `playlists` | Playlist metadata | id, name, position, created_at | None |
| `playlist_items` | Playlist tracks | id, playlist_id, track_id, position | playlists, library |
| `favorites` | Favorited tracks | id, track_id, timestamp | library |
| `settings` | Key-value config | key, value | None |
| `scrobble_queue` | Offline Last.fm queue | artist, track, album, timestamp, retry_count | None |
| `watched_folders` | Auto-scan folders | path, mode, cadence_minutes, enabled | None |
| `lyrics_cache` | Cached lyrics | artist, title, lyrics, source_url | None |

#### Migration Recommendations

**Phase**: **1** (Foundation)
**Effort**: 2-3 weeks

- Migrate to `rusqlite` with connection pooling (`r2d2` or `deadpool`)
- Implement same schema with migrations (`refinery` or `sqlx` migrations)
- Create Rust models matching Python Pydantic models (use `serde`)
- Implement CRUD operations with async support (`tokio`)
- Maintain exact same database file format for backward compatibility
- Add comprehensive integration tests to ensure parity

#### Rust Crate Recommendations

- `rusqlite` - SQLite interface
- `r2d2` or `deadpool` - Connection pooling
- `refinery` or `sqlx` - Schema migrations
- `serde` - Serialization for models
- `tokio` - Async runtime

---

### 2. Library Management API

**File**: `backend/routes/library.py` (292 lines)
**Impact**: **HIGH** - Core feature for music browsing
**Complexity**: **MEDIUM**
**Dependencies**: Database service, scanner service, artwork service

#### Endpoints

| Method | Path | Purpose | Complexity |
|--------|------|---------|------------|
| GET | `/api/library` | Paginated library with filters, search, sort | Medium |
| GET | `/api/library/stats` | Library statistics (tracks, artists, albums, size) | Low |
| GET | `/api/library/{track_id}` | Single track details | Low |
| GET | `/api/library/{track_id}/artwork` | Album artwork (base64-encoded) | Medium |
| DELETE | `/api/library/{track_id}` | Remove track from library | Low |
| PUT | `/api/library/{track_id}/rescan` | Re-extract metadata from file | Medium |
| PUT | `/api/library/{track_id}/play-count` | Increment play count | Low |
| POST | `/api/library/scan` | Scan paths for audio files (2-phase) | High |
| GET | `/api/library/missing` | List missing tracks | Low |
| POST | `/api/library/{track_id}/locate` | Update filepath for missing track | Low |
| POST | `/api/library/{track_id}/check-status` | Check if file exists | Low |
| POST | `/api/library/{track_id}/mark-missing` | Manual mark as missing | Low |
| POST | `/api/library/{track_id}/mark-present` | Manual mark as present | Low |

#### Migration Recommendations

**Phase**: **2** (Core Features)
**Effort**: 2-3 weeks

- Implement Tauri commands for all endpoints
- Use `axum` or `actix-web` if keeping HTTP API (recommended for consistency)
- Integrate with metadata extraction (see section 5)
- Implement artwork extraction (see section 5)
- Add progress reporting for long-running scans via Tauri events

#### Rust Implementation Notes

- Query parameters: Use `axum::extract::Query<Params>` or Tauri command args
- Pagination: Implement with `LIMIT` and `OFFSET` SQL clauses
- Sorting: Dynamic ORDER BY clauses (validate column names)
- Search: `LIKE` queries with proper escaping

---

### 3. Queue Management API

**File**: `backend/routes/queue.py` (126 lines)
**Impact**: **HIGH** - Core playback feature
**Complexity**: **LOW-MEDIUM**
**Dependencies**: Database service

#### Endpoints

| Method | Path | Purpose | Complexity |
|--------|------|---------|------------|
| GET | `/api/queue` | Get current queue with track metadata | Low |
| POST | `/api/queue/add` | Add tracks by ID (optional position) | Low |
| POST | `/api/queue/add-files` | Add files directly (drag-drop) | Medium |
| DELETE | `/api/queue/{position}` | Remove track at position | Low |
| POST | `/api/queue/clear` | Clear entire queue | Low |
| POST | `/api/queue/reorder` | Move track from position A to B | Low |
| POST | `/api/queue/shuffle` | Shuffle queue (optional keep_current) | Low |

#### Migration Recommendations

**Phase**: **2** (Core Features)
**Effort**: 1 week

- Straightforward Tauri commands implementation
- Queue state can be managed entirely in Rust
- Emit Tauri events for queue updates to sync frontend
- Use `rand::seq::SliceRandom` for shuffle

#### Rust Implementation Notes

- Queue reordering: Simple `Vec` manipulation
- Shuffle: Use `rand::thread_rng().shuffle()`
- Add files: Validate paths with `std::path::Path::exists()`

---

### 4. Playlists and Favorites API

**Files**: `backend/routes/playlists.py` (150 lines), `backend/routes/favorites.py` (86 lines)
**Impact**: **MEDIUM-HIGH** - Important organization features
**Complexity**: **MEDIUM** (playlists), **LOW** (favorites)
**Dependencies**: Database service

#### Playlists Endpoints

- GET `/api/playlists` - List all playlists with track counts
- POST `/api/playlists` - Create playlist
- GET `/api/playlists/{id}` - Get playlist with tracks
- PUT `/api/playlists/{id}` - Update playlist name
- DELETE `/api/playlists/{id}` - Delete playlist
- POST `/api/playlists/{id}/tracks` - Add tracks to playlist
- DELETE `/api/playlists/{id}/tracks/{position}` - Remove track
- POST `/api/playlists/{id}/reorder` - Reorder tracks
- POST `/api/playlists/reorder` - Reorder playlists in sidebar

#### Favorites Endpoints

- GET `/api/favorites` - Get favorited tracks
- GET `/api/favorites/top-25` - Top 25 most played
- GET `/api/favorites/recently-played` - Recently played (14 days)
- GET `/api/favorites/recently-added` - Recently added (14 days)
- POST `/api/favorites/{track_id}` - Add to favorites
- DELETE `/api/favorites/{track_id}` - Remove from favorites
- GET `/api/favorites/{track_id}` - Check if favorited

#### Migration Recommendations

**Phase**: **3** (Enhanced Features)
**Effort**: 1-2 weeks

- Standard CRUD operations in Rust
- Emit events for playlist/favorite changes
- Validate unique playlist names with proper error handling

---

### 5. Library Scanning and Metadata Extraction

**Files**: `backend/services/scanner.py` (189 lines), `backend/services/scanner_2phase.py`, `backend/services/artwork.py`
**Impact**: **HIGH** - Core content ingestion
**Complexity**: **MEDIUM-HIGH**
**Dependencies**: mutagen (Python), file system

#### Current Implementation

- **Metadata Extraction** (`mutagen` library):
  - Supports: MP3 (ID3), M4A/MP4, FLAC, OGG, WAV, AAC, WMA, OPUS
  - Extracts: title, artist, album, album_artist, track_number, date, duration
  - File fingerprinting: mtime_ns, file_size

- **2-Phase Scanning** (performance optimized):
  - Phase 1: Fast filesystem walk + fingerprint comparison (stats only)
  - Phase 2: Metadata parsing only for changed files (added/modified)
  - Parallel parsing for large batches (20+ files)
  - Classifications: added, modified, unchanged, deleted

- **Artwork Extraction**:
  - Embedded artwork from audio files
  - Folder-based artwork (cover.jpg, folder.jpg, etc.)
  - Returns base64-encoded image data

#### Migration Recommendations

**Phase**: **2** (Core Features) - Critical path
**Effort**: 2-3 weeks

**Rust Crates for Metadata**:

- `symphonia` - Pure Rust audio decoding and metadata (recommended)
  - Supports: MP3, FLAC, OGG, WAV, AAC, Opus
  - Active development, good performance
- `lofty` - High-level audio tag reading/writing
  - Simple API, supports many formats
  - Better for pure metadata extraction without decoding
- `metaflac` - FLAC-specific metadata (if needed)
- `id3` - ID3 tag parsing for MP3

**Recommended Approach**:

1. Use `lofty` as primary metadata extractor (simple, comprehensive)
2. Fall back to `symphonia` for formats `lofty` doesn't support
3. Implement parallel scanning with `rayon` or `tokio`
4. Use `walkdir` for filesystem traversal
5. Emit progress events via Tauri for UI feedback

**Artwork Extraction**:

- `lofty` supports extracting embedded artwork
- Use `image` crate for format conversion if needed
- Search folder for common artwork filenames

**Critical**: This is a blocking dependency for Phase 2. Must be implemented early to maintain feature parity.

---

### 6. WebSocket Real-time Events

**File**: `backend/routes/websocket.py` (140 lines)
**Impact**: **MEDIUM** - Real-time UI synchronization
**Complexity**: **LOW-MEDIUM**
**Dependencies**: FastAPI WebSocket, frontend

#### Current Implementation

- WebSocket endpoint at `/ws`
- Connection manager broadcasts events to all clients
- Events:
  - `library:updated` - Library changes (action, track_ids)
  - `queue:updated` - Queue changes (action, positions, queue_length)
  - `favorites:updated` - Favorites changes (action, track_id)
  - `playlists:updated` - Playlist changes (action, playlist_id, track_ids)
  - `settings:updated` - Settings changes (key, value, previous_value)
  - `library:scan-progress` - Scan progress (job_id, status, scanned, found, errors)
  - `library:scan-complete` - Scan completion (job_id, stats)
  - `heartbeat` - Keep-alive ping

#### Migration Recommendations

**Phase**: **2** (Core Features)
**Effort**: 1 week

**Replacement**: **Tauri Event System** (RECOMMENDED)

Tauri has a built-in event system that **eliminates the need for WebSocket**:

- Use `app.emit()` to send events from Rust backend
- Frontend listens with `await appWindow.listen('event-name', handler)`
- Typed events with `serde` serialization
- No separate WebSocket server needed
- Better integration with Tauri architecture

**Implementation**:
```rust
use tauri::Manager;

// Emit event from Rust
app.emit_all("library:updated", LibraryUpdatedEvent {
    action: "added",
    track_ids: vec![1, 2, 3],
})?;

// Frontend (JavaScript)
import { appWindow } from '@tauri-apps/api/window';
appWindow.listen('library:updated', (event) => {
    console.log('Library updated:', event.payload);
});
```

**Benefits**:

- No WebSocket server to manage
- Type-safe events with Rust → JavaScript serialization
- Automatic connection management
- Lower latency (IPC vs HTTP)
- Simpler architecture

**Migration**: Replace all WebSocket broadcast calls with Tauri event emissions.

---

### 7. Last.fm Integration

**Files**: `backend/routes/lastfm.py` (360 lines), `backend/services/lastfm.py`
**Impact**: **MEDIUM** - Optional external integration
**Complexity**: **HIGH**
**Dependencies**: Last.fm API, OAuth, database

#### Current Implementation

**Authentication**:

- OAuth 1.0a flow (token request → user authorizes → session key)
- Endpoints: `/lastfm/auth-url`, `/lastfm/auth-callback`, `/lastfm/disconnect`
- Stores: session_key, username in settings table

**Scrobbling**:

- Now playing updates: `/lastfm/now-playing`
- Scrobble submission: `/lastfm/scrobble`
- Offline queue for failed scrobbles (retry logic)
- Settings: enabled, scrobble_threshold (25-100%)

**Loved Tracks Import**:

- Fetch user's loved tracks from Last.fm API (paginated)
- Match to library tracks (case-insensitive artist/title)
- Add to favorites and mark as Last.fm loved

**Queue Management**:

- `/lastfm/queue/status` - Count queued scrobbles
- `/lastfm/queue/retry` - Manual retry

#### Migration Recommendations

**Phase**: **4** (Optional Features)
**Effort**: 2-3 weeks

**Rust Crates**:

- `reqwest` - HTTP client for API calls
- `oauth1` - OAuth 1.0a implementation
- `sha256` - API signature generation
- `serde_json` - JSON parsing

**Complexity Factors**:

- OAuth 1.0a signature generation (requires careful implementation)
- API rate limiting (Last.fm has strict limits)
- Retry logic for failed scrobbles
- Paginated API responses (loved tracks can be 1000+)

**Recommended Approach**:

1. Implement Last.fm API client as separate module
2. Use `tokio` for async HTTP requests
3. Implement exponential backoff for retries
4. Emit Tauri events for scrobble status updates
5. Store API keys in environment variables (not hardcoded)

**Priority**: LOW - This can be deferred to Phase 4 since it's an optional feature. Core playback and library features should be prioritized.

---

### 8. Settings Management

**File**: `backend/routes/settings.py` (56 lines)
**Impact**: **LOW-MEDIUM** - Configuration storage
**Complexity**: **LOW**
**Dependencies**: Database service

#### Endpoints

- GET `/api/settings` - Get all settings
- PUT `/api/settings` - Update multiple settings

#### Migration Recommendations

**Phase**: **1** (Foundation) or **3** (Enhanced Features)
**Effort**: 1-2 days

- Simple key-value storage in database
- Type coercion for booleans and integers
- Emit events when settings change
- Consider using Tauri's built-in `Store` API as an alternative

---

### 9. Watched Folders Management

**File**: `backend/routes/watched_folders.py` (118 lines)
**Impact**: **MEDIUM** - Automation feature
**Complexity**: **MEDIUM**
**Dependencies**: Database service, filesystem watcher

#### Current Implementation

- CRUD operations for watched folders
- Modes: `startup` (scan on launch), `background` (periodic scan), `manual`
- Cadence: minutes between scans for background mode
- Enabled/disabled state

#### Migration Recommendations

**Phase**: **3** (Enhanced Features) or **4** (Optional Features)
**Effort**: 1-2 weeks

**Rust Crates**:

- `notify` - Cross-platform filesystem watcher
- `tokio::time` - Periodic scanning with async timers

**Implementation Notes**:

- Use `notify` for real-time file system events (more efficient than polling)
- Background scanning with `tokio::spawn` for concurrent operation
- Emit events for scan progress and completion

---

## Migration Impact vs Complexity Matrix

| Component | Impact | Complexity | Priority | Phase |
|-----------|--------|------------|----------|-------|
| Database Operations | HIGH | MEDIUM-HIGH | CRITICAL | 1 |
| Library Management API | HIGH | MEDIUM | CRITICAL | 2 |
| Metadata Extraction | HIGH | MEDIUM-HIGH | CRITICAL | 2 |
| Queue Management | HIGH | LOW-MEDIUM | CRITICAL | 2 |
| WebSocket → Tauri Events | MEDIUM | LOW-MEDIUM | HIGH | 2 |
| Playlists | MEDIUM-HIGH | MEDIUM | HIGH | 3 |
| Favorites | MEDIUM | LOW | HIGH | 3 |
| Settings | LOW-MEDIUM | LOW | MEDIUM | 3 |
| Watched Folders | MEDIUM | MEDIUM | MEDIUM | 3 |
| Last.fm Integration | MEDIUM | HIGH | LOW | 4 |

---

## Phased Migration Roadmap

### Phase 1: Foundation (2-3 weeks)

**Goal**: Establish Rust database layer with full parity

**Tasks**:

1. Set up Rust project structure and dependencies
2. Implement SQLite connection pooling with `rusqlite` + `r2d2`
3. Create database schema with migrations (`refinery` or `sqlx`)
4. Implement Rust models matching Python Pydantic models
5. Implement all database CRUD operations
6. Write comprehensive integration tests
7. Verify database file format compatibility

**Deliverables**:

- `src-tauri/src/db/` module with full database functionality
- Integration tests covering all CRUD operations
- Migration scripts for schema updates

**Risk**: MEDIUM - Database is foundation for everything else. Must be rock-solid.

---

### Phase 2: Core Features (3-4 weeks)

**Goal**: Migrate library browsing, queue management, and metadata extraction

**Tasks**:

1. **Metadata Extraction** (Week 1-2):
   - Integrate `lofty` and `symphonia` crates
   - Implement parallel scanning with progress events
   - Implement 2-phase scanning (fingerprint comparison)
   - Add artwork extraction
   - Test with various audio formats

2. **Library API** (Week 2-3):
   - Implement library browsing with filters, search, sort
   - Implement library statistics
   - Implement track CRUD operations
   - Implement scan endpoint with progress reporting
   - Implement missing track management

3. **Queue API** (Week 3):
   - Implement queue CRUD operations
   - Implement shuffle and reorder
   - Emit Tauri events for queue updates

4. **WebSocket Replacement** (Week 3-4):
   - Replace WebSocket broadcasts with Tauri events
   - Update frontend to use `appWindow.listen()`
   - Remove WebSocket connection management code

**Deliverables**:

- Functional library browsing and scanning in Rust
- Queue management fully migrated
- Real-time UI updates via Tauri events
- Remove FastAPI library and queue routes

**Risk**: MEDIUM-HIGH - Metadata extraction is complex and must support many formats.

---

### Phase 3: Enhanced Features (2-3 weeks)

**Goal**: Migrate playlists, favorites, settings, and watched folders

**Tasks**:

1. **Playlists** (Week 1):
   - Implement playlist CRUD operations
   - Implement track management within playlists
   - Implement playlist reordering

2. **Favorites** (Week 1):
   - Implement favorites CRUD operations
   - Implement top 25 / recently played / recently added queries

3. **Settings** (Week 2):
   - Implement settings management
   - Consider using Tauri's built-in Store API

4. **Watched Folders** (Week 2-3):
   - Implement watched folders CRUD
   - Integrate `notify` for filesystem watching
   - Implement periodic scanning with `tokio::time`

**Deliverables**:

- Playlists fully functional in Rust
- Favorites fully functional in Rust
- Settings management migrated
- Watched folders with real-time filesystem monitoring
- Remove FastAPI playlists, favorites, settings, watched_folders routes

**Risk**: LOW - These are mostly CRUD operations with well-defined behavior.

---

### Phase 4: Optional Features (2-3 weeks)

**Goal**: Migrate Last.fm integration (if desired)

**Tasks**:

1. Implement Last.fm API client with OAuth 1.0a
2. Implement scrobbling with offline queue
3. Implement now playing updates
4. Implement loved tracks import
5. Test OAuth flow end-to-end
6. Test scrobble retry logic

**Deliverables**:

- Last.fm integration fully migrated to Rust
- Remove FastAPI lastfm routes
- **Remove entire Python backend and PEX build system**

**Alternative**: Keep Python backend for Last.fm integration only if OAuth 1.0a proves too complex. However, this negates the main benefit of removing Python dependency.

**Risk**: MEDIUM - OAuth 1.0a signature generation is error-prone. API rate limiting must be handled carefully.

---

### Phase 5: Cleanup and Optimization (1 week)

**Goal**: Remove Python backend entirely and optimize Rust implementation

**Tasks**:

1. Remove all FastAPI code and dependencies
2. Remove PEX build system (`taskfiles/pex.yml`)
3. Update `tauri.conf.json` to remove sidecar binary
4. Remove Python from `pyproject.toml` and `mise` configuration
5. Update documentation to reflect Rust-only backend
6. Benchmark performance and optimize hot paths
7. Profile memory usage and optimize allocations
8. Add comprehensive error handling and logging

**Deliverables**:

- Python-free codebase
- Simplified build system
- Performance benchmarks
- Updated documentation

**Risk**: LOW - Cleanup phase with no new features.

---

## Testing Strategy

### Unit Tests

- Rust unit tests for all database operations
- Rust unit tests for metadata extraction
- Rust unit tests for business logic

### Integration Tests

- End-to-end tests for each API endpoint
- Database migration tests
- Filesystem scanning tests with test fixtures

### Regression Tests

- Compare Rust and Python implementations side-by-side
- Verify identical behavior for all operations
- Test with real-world music library

### Performance Tests

- Benchmark library scanning (10k, 50k, 100k+ tracks)
- Benchmark queue operations
- Benchmark metadata extraction
- Compare Python vs Rust performance

---

## Dependency Analysis

### Critical Dependencies (Phase 1-2)

- Database implementation blocks everything
- Metadata extraction blocks library scanning
- Library API blocks queue management

### Soft Dependencies (Phase 3-4)

- Playlists independent of other features
- Favorites independent of other features
- Settings independent of other features
- Last.fm independent of core functionality

### Frontend Dependencies

- Frontend must be updated to use Tauri commands instead of HTTP API
- WebSocket event listeners must be converted to Tauri events
- API URL configuration must be removed

---

## Risk Assessment

### High Risk Areas

1. **Metadata Extraction** (Phase 2):
   - Many audio formats to support
   - Edge cases in tag parsing
   - **Mitigation**: Extensive testing with diverse audio files, fallback to filename if parsing fails

2. **Database Migrations** (Phase 1):
   - Must maintain backward compatibility with existing databases
   - Schema changes must not corrupt data
   - **Mitigation**: Comprehensive migration tests, database backups before migration

3. **OAuth 1.0a Implementation** (Phase 4):
   - Complex signature generation
   - Easy to make subtle mistakes
   - **Mitigation**: Use well-tested Rust crate, extensive integration tests with Last.fm API

### Medium Risk Areas

1. **Performance Regressions**:
   - Rust implementation must be as fast or faster than Python
   - **Mitigation**: Benchmark early and often, optimize hot paths

2. **Feature Parity**:
   - Must maintain exact same behavior as Python implementation
   - **Mitigation**: Comprehensive regression tests, side-by-side comparison

### Low Risk Areas

1. **CRUD Operations**: Standard database operations are well-understood
2. **Tauri Events**: Tauri event system is stable and well-documented
3. **Settings Management**: Simple key-value storage

---

## Performance Expectations

### Expected Improvements

| Operation | Python (Current) | Rust (Expected) | Improvement |
|-----------|------------------|-----------------|-------------|
| Library Scan (10k tracks) | ~30s | ~5-10s | 3-6x faster |
| Metadata Extraction (single file) | ~10ms | ~2-5ms | 2-5x faster |
| Database Query (paginated) | ~50ms | ~10-20ms | 2-5x faster |
| Queue Operations | ~5ms | ~1ms | 5x faster |
| Memory Usage (baseline) | ~150MB | ~20-30MB | 5-7x lower |

**Note**: These are rough estimates based on typical Rust vs Python performance characteristics. Actual results will vary.

---

## Recommended Tools and Libraries

### Rust Crates

| Category | Crate | Purpose |
|----------|-------|---------|
| Database | `rusqlite` | SQLite interface |
| Connection Pool | `r2d2` or `deadpool` | Connection pooling |
| Migrations | `refinery` or `sqlx` | Schema migrations |
| Metadata | `lofty` | Audio tag reading (primary) |
| Metadata | `symphonia` | Audio decoding and metadata (fallback) |
| Filesystem | `walkdir` | Directory traversal |
| Filesystem | `notify` | Filesystem watcher |
| Parallel | `rayon` | Data parallelism |
| Async | `tokio` | Async runtime |
| HTTP Client | `reqwest` | HTTP requests (Last.fm) |
| OAuth | `oauth1` | OAuth 1.0a (Last.fm) |
| Serialization | `serde` + `serde_json` | JSON serialization |
| Error Handling | `anyhow` or `thiserror` | Error types |
| Logging | `tracing` | Structured logging |

---

## Conclusion

The migration from FastAPI PEX sidecar to Rust backend is **feasible and highly beneficial**. The phased approach minimizes risk by:

1. Building a solid foundation (database layer)
2. Migrating core features first (library, queue, metadata)
3. Migrating enhanced features next (playlists, favorites, settings)
4. Deferring optional features (Last.fm) to the end

**Total Estimated Effort**: 10-14 weeks

**Key Success Factors**:

- Comprehensive testing at each phase
- Maintain backward compatibility with existing databases
- Leverage Tauri's built-in event system (no WebSocket needed)
- Use well-tested Rust crates for complex tasks (metadata, OAuth)

**Recommendation**: **Proceed with migration**. The benefits (performance, simplified deployment, reduced attack surface) outweigh the implementation effort. Start with Phase 1 immediately to establish the foundation.

---

## Next Steps

1. Review and approve this migration plan
2. Set up Rust project structure and dependencies
3. Begin Phase 1: Database layer implementation
4. Establish testing framework and CI pipeline
5. Regular progress reviews at end of each phase

---

**End of Analysis Report**
