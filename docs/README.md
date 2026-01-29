# MT Music Player Documentation

This directory contains documentation for the MT music player project.

## Current Architecture

MT is a desktop music player built with:

- **Frontend**: Tauri WebView with Alpine.js + Basecoat (Tailwind CSS)
- **Backend**: Pure Rust (all 87 Tauri commands)
- **Audio**: Rodio/Symphonia for playback
- **Database**: SQLite via rusqlite

## Documentation

- [**Testing Guide**](testing.md) - Testing strategy, E2E workflows, and MCP-based test authoring
- [**Tauri Architecture**](tauri-architecture.md) - System architecture and component design
- [**Last.fm Integration**](lastfm.md) - Rust implementation of Last.fm scrobbling and authentication
- [**FastAPI Migration Analysis**](fastapi-to-rust-migration-analysis.md) - Historical reference for the Python-to-Rust migration

## Development Context

For comprehensive development guidance, see the root [`CLAUDE.md`](../CLAUDE.md) which covers:

- Development commands and workflows
- Testing strategy (Rust, Vitest, Playwright)
- Architecture overview
- Code style and patterns
