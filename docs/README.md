# MT Music Player Documentation

This directory contains documentation for the MT music player project.

## Current Architecture

MT is a desktop music player built with:

- **Frontend**: Tauri WebView with Alpine.js + Basecoat (Tailwind CSS)
- **Backend**: Pure Rust (all 91 Tauri commands)
- **Audio**: Rodio/Symphonia for playback
- **Database**: SQLite via rusqlite

## Documentation

- [**Development Guide**](development.md) - Commands, tooling, dependencies, and workflows
- [**Testing Guide**](testing.md) - Testing strategy, E2E workflows, and MCP-based test authoring
- [**Git Workflow**](git-workflow.md) - Atomic commits, interactive staging, and worktree management
- [**Tauri Architecture**](tauri-architecture.md) - System architecture and component design
- [**MCP Tool Reference**](mcp-reference.md) - Tauri MCP bridge tools for debugging and testing
- [**Debugging Guide**](debugging.md) - Remote debugging, crash analysis, and SIGILL troubleshooting
- [**Last.fm Integration**](lastfm.md) - Rust implementation of Last.fm scrobbling and authentication
- [**Build Configuration**](builds.md) - Cross-platform builds, signing, and CI/CD

### Historical Reference

- [**FastAPI Migration Analysis**](fastapi-to-rust-migration-analysis.md) - Python-to-Rust migration record

## Development Context

For agent-specific guidance (LLM behavior rules, Context7 libraries, backlog workflow), see the root [`AGENTS.md`](../AGENTS.md).
