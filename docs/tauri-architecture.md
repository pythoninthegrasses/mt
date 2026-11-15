# Tauri Architecture

MT is a desktop music player migrating to a Zig application engine with a Rust
Tauri shell and narrow mature-library/OS adapters.

## Approved target: Zig-first

[ADR-0001](adr/0001-zig-first-engine.md) records the maintainer-approved decision.
Zig owns domain logic, SQL/migrations, queue/session rules, scan/reconcile,
artwork/cache policy and service/agent orchestration. Rust retains Tauri and
named audio, metadata, image, HTTPS, provider-SDK and OS primitives—not their
surrounding policy or storage.

Frontend domain requests use authenticated loopback HTTP to Zig. Private
NDJSON stdin/stdout carries Rust capability calls/native observations and
engine events; one Tauri bridge forwards domain events to the frontend.
Rust supervises the child. During transition Rust is the only schema migrator;
TASK-354 establishes version safety and TASK-393.26 hands exclusive DB/migration
ownership to Zig. Engine readiness gates domain requests/jobs; no silent Rust
fallback or hardcoded-port success path is part of the target.

TASK-393 freezes new product features until .28 verifies completion; bugfixes
and migration-required refactors remain allowed. Existing data and behavior
must survive. No benchmark campaign is required and no performance superiority
is established.

- [Task sequence, startup/jobs, test conventions and scope risks](zig-first-migration.md)
- [Every Rust module and retained capability](zig-first-ownership.md)
- [All 142 current registered commands](zig-first-commands.md)
- [Frontend business-logic inventory](zig-first-frontend.md)
- [DB domains, non-SQL stores and direct callers](zig-first-storage.md)
- [Historical measurements and unknowns](zig-first-evidence.md)

## Current implementation (transitional, not the target)

The remaining sections are transitional/historical Rust reference alongside the
additive TASK-355 POC, not approval to retain Rust domain logic. Legacy schematic
examples are not executable API contracts; the current source and ownership
inventory govern capability transfer/deletion.

| Component | Technology |
|-----------|------------|
| Frontend | Tauri WebView (Alpine.js + Basecoat) |
| Backend | Rust core/desktop (142 registered Tauri commands at `205a968`), plus one Zig HTTP library read |
| Audio | Rust audio engine (symphonia + rodio) |
| Database | SQLite via rusqlite; Zig POC opens read-only |
| Media Keys | souvlaki (Now Playing/MPRIS/SMTC) + tauri-plugin-global-shortcut (keyboard F7/F8/F9) |

### Transitional database schema contract (TASK-354)

`PRAGMA user_version = 1` represents the existing complete schema, including
Plex/source columns, queue state, deduplication, revision and artist-sort-key
columns/indexes/triggers. The constant lives in `mt-core/src/db/version.rs`
(under `crates/`) and is mirrored in `zig-core/src/sqlite.zig` and
`scripts/agent.py`. Update consumers together for any future version change.

- **Version 0 is unversioned, not necessarily empty.** Rust accepts an empty
  SQLite database or a recognizable legacy mt schema, preserving populated
  tracks, relationships and settings while applying existing incremental
  upgrades. An unrelated/invalid legacy schema fails instead of being reset.
- **One migrator:** `mt_core::db::Database::new` runs Rust initialization before
  building the pool; the Tauri setup completes it before spawning Zig. The
  in-memory test constructor uses the same initializer. Low-level schema
  helpers remain for isolated legacy-schema tests, not additional production
  startup paths.
- Rust acquires `BEGIN IMMEDIATE`, **rechecks the version under the writer
  lock**, and commits base creation, incremental DDL/backfills and version 1
  together. A competing startup waits (5-second busy timeout), then skips the
  upgrade if the first startup committed. Current-version startup does not
  rerun backfills or repair schema silently.
- Pool connections/checkouts, Zig's read-only opener and the standalone Python
  agent check compatibility. Non-migrators refuse version 0, unsupported older
  values and newer versions. Run a matching mt build to migrate an old DB;
  use a matching/newer build for a newer DB. **Never delete/reset `mt.db` or
  manually change its version to bypass a refusal.**
- Errors roll back the whole upgrade; process interruption relies on SQLite
  journal/WAL recovery. Readers see the old committed version until commit
  and must reject it, not publish readiness against partial work. Lock timeout
  is recoverable by closing competing writers and retrying startup. WAL mode
  is configured after the schema commit; a later WAL/pool failure may leave a
  fully upgraded database, never a half-upgraded version 1.
- This is not corruption repair, a backup, or a cross-process application
  lifetime lock. Version 1 is a compatibility assertion, not a full integrity
  scan. Older binaries that do not implement the contract cannot be made safe
  by this guard; do not run them concurrently. The existing `synchronous=NORMAL`
  policy does not promise power-loss durability of the latest committed writes.

TASK-393.6 may add version-checked Zig write transactions, **not migrations**.
TASK-393.26 transfers exclusive migration ownership to Zig and removes the
Rust migrator only after all callers/fixtures have transferred.

## Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           Tauri Application                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                     Frontend (WebView)                           │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐   │   │
│  │  │  Alpine.js  │  │  Basecoat   │  │    Player Controls      │   │   │
│  │  │   Stores    │  │  Components │  │    Library Browser      │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                    Tauri invoke / events                                │
│                              │                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Tauri Core (Rust)                             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐   │   │
│  │  │   Window    │  │   Menus     │  │     Media Keys          │   │   │
│  │  │  Lifecycle  │  │   & Tray    │  │   (tauri-plugin-global- │   │   │
│  │  │             │  │             │  │    shortcut)            │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘   │   │
│  │                                                                  │   │
│  │  ┌───────────────────────────────────────────────────────────┐   │   │
│  │  │              Rust Audio Engine                            │   │   │
│  │  │  ┌───────────┐  ┌───────────┐  ┌───────────────────────┐  │   │   │
│  │  │  │ symphonia │  │   rodio   │  │   Audio State         │  │   │   │
│  │  │  │  (decode) │  │  (output) │  │   (position, volume)  │  │   │   │
│  │  │  └───────────┘  └───────────┘  └───────────────────────┘  │   │   │
│  │  └───────────────────────────────────────────────────────────┘   │   │
│  │                                                                  │   │
│  │  ┌───────────────────────────────────────────────────────────┐   │   │
│  │  │              Data Layer (Rust)                            │   │   │
│  │  │  ┌───────────┐  ┌───────────┐  ┌───────────────────────┐  │   │   │
│  │  │  │  SQLite   │  │  Library  │  │    Metadata           │  │   │   │
│  │  │  │ (rusqlite)│  │  Scanner  │  │    (lofty-rs)         │  │   │   │
│  │  │  └───────────┘  └───────────┘  └───────────────────────┘  │   │   │
│  │  └───────────────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Rust Workspace

The backend is split into two crates (TASK-353). The split is behavior-preserving: command
names, registration, and the `Result<_, String>` error strings the frontend reads are the
same as they were in the single crate.

| Crate | Responsibility |
|-------|------------------------|
| `crates/mt-core/` | Tauri-independent SQLite database, pure scanner, Last.fm client, Plex client/merge, audio tag reading/writing, library view-model layer, queue orchestration, network file cache, and platform mount detection |
| `crates/mt-tauri/` | Desktop application, command/event adapters, audio, scanner artwork, and remaining integration modules |

`mt-tauri` depends on `mt-core` and re-exports its cache, database, scanner, Last.fm, Plex,
metadata, and library APIs internally
so existing desktop callers retain the same paths. Their implementations and
unit/property tests live only in `mt-core`; run them without linking the desktop framework
using `cargo nextest run -p mt-core`. The queue adapter is the exception: it calls
`mt_core::queue` under an alias, because a bare `queue::` in the desktop module has always
meant the SQL layer (`crate::db::queue`).

The desktop `db` adapter retains only the test-only Zig database fixture generator,
preserving its existing `db::fixture_gen` test filter and sidecar parity harness.
Database pooling, schema migrations, SQL queries, and queue persistence/navigation
belong to the core; desktop commands still own event emission.

The core scanner owns shared scan types, filesystem fingerprints/content hashing,
inventory, parallel metadata parsing, and two-phase scan orchestration. Its existing
unit tests and performance tests run in the core. The desktop scanner retains
artwork extraction/caching and Tauri commands; progress callbacks cross the boundary
without introducing desktop handles or events into the core.

The core Plex module owns the HTTP client, response DTOs, track matching, and
transactional library merging, including their existing mock-server tests.
The desktop Plex module retains downloads; commands retain settings and event emission.
Shared mock-server fixtures live in `crates/mt-core/tests/fixtures/plex/`;
desktop command tests reference those same fixtures.

The core Last.fm module owns the HTTP client, signing, rate limiting, DTOs, and
their tests. Client construction takes explicit `ApiKeyConfig` credentials.
The desktop `lastfm::new_client()` factory still loads runtime environment values
before falling back to `option_env!` values embedded by `mt-tauri/build.rs`;
the core never loads or embeds credentials. Desktop commands retain settings,
scrobble orchestration, and event emission. The desktop `agent` feature forwards
to the core's dependency-free `agent` feature for Last.fm discovery APIs.

The core `metadata` module owns the metadata editor's lofty tag reading and writing:
`TrackMetadata`/`MetadataUpdate` DTOs, single-file and rayon-parallel batch reads, and
tag writes that recreate an unreadable tag. The desktop `metadata` module retains the
three Tauri commands and their `tracing::instrument` spans, so span names and command
registration are unchanged.

The core `library` module owns what the `library_*` commands wrapped around the SQL layer:
building a `LibraryQuery` from request arguments, assembling each section view model
(`all`, `liked`, `top25`, `recent`, `added`, `playlist-*`) with its totals and revision,
pairing each mutation with the removal records and reconcile totals that must share its
transaction, and the fingerprint-backfill/dedup pipeline. It returns the same
`Result<_, String>` the commands returned, so frontend-visible error strings are unchanged.
The desktop `library` module retains the command adapters — signatures, spans, slow-command
logs, the artwork LRU cache — the `settings.json` read for
`library.deduplicateAcrossDirectories`, and all event emission. The pipeline reports its
phases through the core's `ReconcileProgress` trait, which the desktop bridges to
`reconcile-progress` events; the response DTOs are core types re-exported for the
shadow-diff harness.

The core `queue` module owns what the `queue_*` commands wrapped around the queue's SQL
layer: the response shapes the frontend reads, which positions a write landed on, and the
order a request's announcements go out in — enabling shuffle announces a `shuffled` update
and then a state change, adding to play-next announces `added` and then a state change, a
play context announces `cleared` and then a state change. It also owns the four
navigation commands, which differ only in how they enter the state machine, and the two
play-context commands. Functions take a `Database` and return the same `Result<_, String>`
the commands returned, so frontend-visible error strings are unchanged. The desktop
`commands::queue` module retains the command adapters — signatures and spans — plus two
seams the core asks the desktop for: `QueueReporter`, bridged onto the `queue:updated` and
`queue:state_changed` events, and `navigation::PlaybackSink`, implemented over the audio
engine so a navigation request can start a file. The response DTOs are core types
re-exported through the adapter.

CI checks the core's transitive normal, build, and test dependencies across all
targets and features, rejecting Tauri, Tao, Wry, WebKit, and Objective-C 2 crates.
At the TASK-353 extraction boundary, the Plex downloader stayed in the desktop
crate: it streams to disk with `tokio`'s `fs` and `io-util` features, resolves the music
directory through `dirs`, reads the size cap from `settings.json`, and emits its own
progress events — desktop concerns the core has no reason to carry, and pulling them in
would mean adding dependencies the core does not otherwise need. That extraction
choice is not a final Rust exception: TASK-393.19/.22 transfer its policy to Zig.
The audio engine,
artwork, watcher, and download tests therefore still link the desktop framework.

### Tauri Core (Rust)

The transitional Rust backend still handles the following functionality; the
Zig-first inventory assigns its final owners:

| Component | Responsibility |
|-----------|----------------|
| **Window Lifecycle** | Create, resize, minimize, close, fullscreen |
| **Native Menus** | Application menu, context menus |
| **Media Keys** | OS media integration via `souvlaki` (Now Playing/MPRIS/SMTC) + `tauri-plugin-global-shortcut` for keyboard media keys (F7/F8/F9). macOS keyboard sends `NX_KEYTYPE_REWIND`/`FAST` (not `PREVIOUS`/`NEXT`), so both code families are registered. |
| **Audio Engine** | Decode and play audio with sub-millisecond latency |
| **Database** | SQLite operations via rusqlite |
| **Library Scanner** | Directory traversal, metadata extraction |
| **Last.fm** | Scrobbling, authentication, loved tracks |

### Rust Audio Engine

Native audio playback:

| Library | Purpose |
|---------|---------|
| **symphonia** | Audio decoding (FLAC, MP3, M4A/AAC, OGG/Vorbis, WAV) |
| **rodio** | Audio output abstraction (wraps cpal) |
| **cpal** | Cross-platform audio I/O |

**Audio State:**

- Current position (milliseconds)
- Duration
- Volume (0.0 - 1.0)
- Playing/paused state
- Loop mode (none, track, queue)

### Data Layer (Rust)

All data operations in native Rust:

| Component | Responsibility |
|-----------|----------------|
| **rusqlite** | SQLite database (`mt.db` in Tauri app data dir) |
| **lofty-rs** | Audio metadata extraction |
| **Library Scanner** | Recursive directory traversal |
| **Watched Folders** | File system monitoring |

### Frontend (WebView)

Modern web UI:

| Technology | Purpose |
|------------|---------|
| **Alpine.js** | Reactive state management, minimal footprint |
| **Basecoat** | Tailwind-based component library |
| **Vite** | Fast development builds, HMR |

**UI Components:**

- Library browser (virtual scrolling)
- Artists browser (split-pane: artist list + album/track detail)
- Albums browser (grid layout with album artwork)
- Queue view (drag-and-drop reordering)
- Player controls (play/pause, seek, volume)
- Search bar (instant filtering)
- Sidebar navigation (library sections, playlists)
- Settings panel
- Metadata editor

**Mixin Architecture:**

Large Alpine.js components use a mixin factory pattern to keep files under 500 LOC. Each mixin is a function that returns a plain object spread into the component:

| Mixin | File | Responsibility |
|-------|------|----------------|
| `typeToJumpMixin` | `js/mixins/type-to-jump.js` | Keyboard-driven artist navigation |
| `columnGeometryMixin` | `js/mixins/column-geometry.js` | Column widths, resize, auto-fit |
| `columnReorderMixin` | `js/mixins/column-reorder.js` | Column drag-and-drop reordering |
| `columnSettingsMixin` | `js/mixins/column-settings.js` | Column visibility, persistence, header context menu |
| `playlistDragMixin` | `js/mixins/playlist-drag.js` | Playlist track reorder via drag |
| `contextMenuActionsMixin` | `js/mixins/context-menu-actions.js` | Context menu, playback, track management |
| `virtualScrollMixin` | `js/mixins/virtual-scroll.js` | Scroll tracking, scroll-to-track |

Mixins use regular `function` syntax so `this` binds to the Alpine component at runtime. Getters must stay in the main component since `...spread` loses getter descriptors. Shared pure utilities live in `js/utils/` and constants in `js/constants.js`.

**View Caching:**

The library store implements persistent caching to eliminate loading spinners when switching between views:

| Feature | Implementation |
|---------|----------------|
| **Per-section cache** | Each library section (Music, Liked, Recent, Added, Top 25) and playlist cached separately |
| **Persistent storage** | Cache stored in Tauri settings (`library:sectionCache`) - survives app restarts |
| **Background refresh** | Cached data shown instantly, fresh data fetched silently in background |
| **Cache invalidation** | Cleared on library changes, playlist modifications, or file system events |

Cache keys: `all`, `liked`, `recent`, `added`, `top25`, `playlist-{id}`

## Communication Patterns

### Frontend ↔ Tauri Core

**Tauri Invoke (Commands):**
```typescript
// Frontend calls Rust function
const status = await invoke('audio_get_status');
await invoke('audio_load', { path: '/path/to/song.mp3' });
await invoke('audio_seek', { positionMs: 30000 });
```

**Tauri Events (Push):**
```typescript
// Rust pushes updates to frontend
listen('playback-progress', (event) => {
  playerStore.position = event.payload.position_ms;
});

listen('track-ended', () => {
  playerStore.playNext();
});
```

### Communication Flow Example

```text
User clicks "Add Music" button
         │
         ▼
┌─────────────────┐
│    Frontend     │  invoke('scan_directory', { path: '/Music' })
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Tauri Core    │  Scans directory, extracts metadata via lofty-rs
│     (Rust)      │  Emits scan-progress events
└────────┬────────┘
         │ emit("scan-progress", { count: 150 })
         ▼
┌─────────────────┐
│    Frontend     │  Updates progress bar
└─────────────────┘
```

## Platform Support

### macOS (Primary)

| Feature | Implementation |
|---------|----------------|
| Window chrome | Native titlebar with traffic lights |
| Media keys | `souvlaki` (Now Playing widget) + `tauri-plugin-global-shortcut` (`MediaRewind`/`MediaFastForward` for F7/F9, `MediaTrackPrevious`/`MediaTrackNext` for AirPods/Bluetooth) |
| Menu bar | Native application menu |
| File associations | Info.plist configuration |

### Linux

| Feature | Implementation |
|---------|----------------|
| Window chrome | Client-side decorations (CSD) |
| Media keys | D-Bus MPRIS integration |
| Audio output | PulseAudio/PipeWire via cpal |

### Windows

| Feature | Implementation |
|---------|----------------|
| Window chrome | Native Win32 frame |
| Media keys | System Media Transport Controls (SMTC) |
| Audio output | WASAPI via cpal |

## Directory Structure

The project uses a Cargo workspace with two crates:

```text
mt/
├── Cargo.toml              # Workspace root (members: mt-core, mt-tauri)
├── crates/
│   ├── mt-core/            # Tauri-independent library
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── cache/      # Network file cache and mount detection
│   │   │   ├── db/         # Database operations and tests
│   │   │   ├── lastfm/     # Last.fm client, signing, rate limiting, DTOs, and tests
│   │   │   ├── library/    # Library queries, sections, mutations, reconcile pipeline
│   │   │   ├── metadata/   # Audio tag reading/writing and tests
│   │   │   ├── plex/       # Plex HTTP client, DTOs, library merge, and tests
│   │   │   ├── queue/      # Queue orchestration, announcements, playback seam
│   │   │   ├── scanner/    # Pure scanning, metadata parsing, and tests
│   │   │   └── lib.rs
│   │   └── tests/fixtures/ # Shared Plex mock-server fixtures
│   └── mt-tauri/           # Desktop app and remaining backend modules
│       ├── src/
│       │   ├── main.rs     # Entry point
│       │   ├── lib.rs      # Module registration and command dispatch
│       │   ├── audio/      # Audio engine module
│       │   ├── commands/   # Tauri command handlers (queue, audio, plex, …)
│       │   ├── db.rs       # Core database re-export; desktop test fixture hook
│       │   ├── events.rs   # EventEmitter abstraction over the desktop events
│       │   ├── lastfm/     # Core re-exports and desktop credential loading
│       │   ├── library/    # Library command adapters over the core view models
│       │   ├── metadata.rs # Core re-exports and metadata editor commands
│       │   ├── plex/       # Core re-exports and desktop downloads
│       │   ├── scanner/    # Core re-exports, artwork, and scan commands
│       │   └── watcher.rs  # File system monitoring
│       ├── Cargo.toml
│       └── tauri.conf.json
├── app/frontend/           # Frontend source
│   ├── index.html
│   ├── js/
│   │   ├── main.js         # Alpine.js initialization
│   │   └── stores/         # Alpine.js stores
│   ├── components/         # UI components
│   └── styles/
│       └── main.css        # Tailwind + Basecoat
└── package.json            # Frontend dependencies
```

## Performance

These legacy observational figures have no controlled Zig-first comparison and
are not target guarantees or migration acceptance gates. For provenance-backed
build evidence and explicitly missing measurements, use
[the historical evidence summary](zig-first-evidence.md).

| Metric | macOS | Linux | Notes |
|--------|-------|-------|-------|
| Cold start | < 500ms | < 1s | |
| Track switch | < 50ms | < 50ms | |
| Memory (idle) | ~115 MB | ~480 MB | WebKitGTK multi-process overhead on Linux |
| CPU (playing) | < 5% | < 5% | |
| Binary size | ~30 MB | ~30 MB | |

See [builds.md](builds.md#runtime-memory-optimization) for memory optimization details.

## Development Tools

### MCP Bridge (AI Agent Debugging)

The optional `tauri-plugin-mcp-bridge` enables AI agents (Claude, Cursor, Windsurf) to interact with the running app via the Model Context Protocol:

```bash
task tauri:dev:mcp   # Run with MCP bridge enabled
```

Features: Screenshots, DOM snapshots, IPC monitoring, UI automation, console logs. See [hypothesi/mcp-server-tauri](https://github.com/hypothesi/mcp-server-tauri).

## Key Dependencies

### Rust (crates/mt-tauri/Cargo.toml)

```toml
[dependencies]
tauri = { version = "2", features = ["shell-open"] }
symphonia = { version = "0.5", features = ["mp3", "flac", "aac", "ogg"] }
rodio = { version = "0.21", features = ["flac", "mp3", "mp4", "vorbis", "wav"] }
rusqlite = { version = "0.38", features = ["bundled"] }
lofty = "0.22"
souvlaki = "0.8"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["json"] }

[dependencies.tauri-plugin-global-shortcut]
version = "2"
```

### Frontend (package.json)

```json
{
  "dependencies": {
    "alpinejs": "^3.14",
    "basecoat-css": "^0.3.10-beta.2"
  },
  "devDependencies": {
    "vite": "^6",
    "tailwindcss": "^4.0",
    "@tailwindcss/vite": "^4.0"
  }
}
```
