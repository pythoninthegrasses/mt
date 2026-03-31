# Tauri Architecture

This document describes the architecture of MT, a desktop music player built with Tauri and native Rust.

## Overview

MT uses a modern pure-Rust architecture:

| Component | Technology |
|-----------|------------|
| Frontend | Tauri WebView (Alpine.js + Basecoat) |
| Backend | Native Rust (91 Tauri commands) |
| Audio | Rust audio engine (symphonia + rodio) |
| Database | SQLite via rusqlite |
| Media Keys | souvlaki (Now Playing/MPRIS/SMTC) + tauri-plugin-global-shortcut (keyboard F7/F8/F9) |

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

### Tauri Core (Rust)

The Rust backend handles all functionality:

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

The project uses a Cargo workspace with a single crate:

```text
mt/
├── Cargo.toml              # Workspace root (members: mt-tauri)
├── crates/
│   └── mt-tauri/           # Tauri app (all backend logic)
│       ├── src/
│       │   ├── main.rs     # Entry point
│       │   ├── audio/      # Audio engine module
│       │   ├── commands/   # Tauri command handlers
│       │   ├── db/         # Database operations
│       │   ├── lastfm/     # Last.fm integration
│       │   ├── scanner/    # Library scanning
│       │   └── watcher/    # File system monitoring
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
