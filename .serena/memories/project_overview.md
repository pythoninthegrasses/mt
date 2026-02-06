# Project Overview

## Purpose
mt is a desktop music player designed for large music collections, built with Tauri (Rust backend), Basecoat (Tailwind CSS), and Alpine.js.

## Tech Stack
- **Frontend**: Alpine.js for reactive state, Basecoat (Tailwind CSS) for UI components, Vite for builds/HMR
- **Backend**: Native Rust (87 Tauri commands)
- **Audio**: symphonia (decode) + rodio (output) + cpal (cross-platform I/O)
- **Database**: SQLite via rusqlite
- **Metadata**: lofty-rs for audio file metadata extraction
- **Async Runtime**: Tokio
- **Serialization**: Serde / serde_json
- **HTTP Client**: reqwest (Last.fm integration)
- **Media Keys**: tauri-plugin-global-shortcut

## Platform Support
- **Primary**: macOS (native titlebar with traffic lights)
- **Secondary**: Linux (CSD, D-Bus MPRIS), Windows (Win32 frame, SMTC)
- Single binary distribution, no external dependencies required

## Directory Structure
- `src-tauri/src/` — Rust backend (audio, commands, db, lastfm, scanner, watcher)
- `app/frontend/` — Frontend source (Alpine.js stores, components, views, styles)
- `app/frontend/js/stores/` — Alpine.js global stores (queue, player, library, settings)
- `app/frontend/js/components/` — UI components (sidebar, library-browser, player, etc.)
- `app/frontend/tests/` — Playwright E2E tests and Vitest unit tests

## Key Architecture Decisions
- Audio playback only works in Tauri runtime, not standalone browsers
- Frontend↔Backend communication via Tauri invoke (commands) and events (push)
- View caching: per-section cache stored in Tauri settings, background refresh
- Queue store maintains tracks in play order; shuffle physically reorders the array