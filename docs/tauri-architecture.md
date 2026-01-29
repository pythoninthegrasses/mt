# Tauri Architecture

This document describes the architecture of MT, a desktop music player built with Tauri and native Rust.

## Overview

MT uses a modern pure-Rust architecture:

| Component | Technology |
|-----------|------------|
| Frontend | Tauri WebView (Alpine.js + Basecoat) |
| Backend | Native Rust (87 Tauri commands) |
| Audio | Rust audio engine (symphonia + rodio) |
| Database | SQLite via rusqlite |
| Media Keys | Cross-platform via Tauri plugins |

## Architecture Diagram

```
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
| **Media Keys** | Global hotkeys via `tauri-plugin-global-shortcut` |
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
| **rusqlite** | SQLite database operations |
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
- Queue view (drag-and-drop reordering)
- Player controls (play/pause, seek, volume)
- Search bar (instant filtering)
- Sidebar navigation (library sections, playlists)
- Settings panel
- Metadata editor

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

```
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
| Media keys | `tauri-plugin-global-shortcut` |
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

```
mt/
├── src-tauri/              # Tauri Rust backend
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   ├── audio/          # Audio engine module
│   │   ├── commands/       # Tauri command handlers
│   │   ├── db/             # Database operations
│   │   ├── lastfm/         # Last.fm integration
│   │   ├── scanner/        # Library scanning
│   │   └── watcher/        # File system monitoring
│   ├── Cargo.toml
│   └── tauri.conf.json
├── app/frontend/           # Frontend source
│   ├── index.html
│   ├── js/
│   │   ├── main.js         # Alpine.js initialization
│   │   └── stores/         # Alpine.js stores
│   ├── components/         # UI components
│   └── styles/
│       └── main.css        # Tailwind + Basecoat
├── package.json            # Frontend dependencies
├── vite.config.js
└── tailwind.config.js
```

## Performance

| Metric | Achieved |
|--------|----------|
| Cold start | < 500ms |
| Track switch | < 50ms |
| Memory (idle) | < 100MB |
| CPU (playing) | < 5% |
| Binary size | ~30MB |

## Development Tools

### MCP Bridge (AI Agent Debugging)

The optional `tauri-plugin-mcp-bridge` enables AI agents (Claude, Cursor, Windsurf) to interact with the running app via the Model Context Protocol:

```bash
task tauri:dev:mcp   # Run with MCP bridge enabled
```

Features: Screenshots, DOM snapshots, IPC monitoring, UI automation, console logs. See [hypothesi/mcp-server-tauri](https://github.com/hypothesi/mcp-server-tauri).

## Key Dependencies

### Rust (Cargo.toml)

```toml
[dependencies]
tauri = { version = "2", features = ["shell-open"] }
symphonia = { version = "0.5", features = ["mp3", "flac", "aac", "ogg"] }
rodio = "0.19"
rusqlite = { version = "0.32", features = ["bundled"] }
lofty = "0.22"
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
    "@aspect/basecoat": "^0.1"
  },
  "devDependencies": {
    "vite": "^6",
    "tailwindcss": "^3.4",
    "@tailwindcss/forms": "^0.5"
  }
}
```
