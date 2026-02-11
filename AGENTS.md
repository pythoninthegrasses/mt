# AGENTS.md

This file provides guidance to LLMs when working with code in this repository.

## Project Overview

mt is a desktop music player designed for large music collections, built with Tauri (Rust backend), basecoat (with Tailwind CSS), and Alpine.js. The backend uses Rust for audio playback and system integration, while the frontend is a modern web-based UI with reactive components.

## General Guidelines

- ALWAYS use atomic commits — see [Git Workflow](docs/git-workflow.md) for interactive staging, patch mode, and worktree management
- NEVER create *.backup files. This is a version controlled repo

## Context7

Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.

### AlpineJS + Basecoat + Tauri Libraries

- alpinejs/alpine
- dubzzz/fast-check
- hunvreus/basecoat
- jdx/mise
- microsoft/playwright
- mrlesk/backlog.md
- nextest-rs/nextest
- serial-ata/lofty-rs
- sharkdp/hyperfine
- tailwindlabs/tailwindcss
- websites/deno
- websites/last_fm_api
- websites/rs_tauri_2_9_5
- websites/taskfile_dev

## Quick Reference

| Topic | Guide |
|-------|-------|
| Commands, tooling, dependencies | [Development Guide](docs/development.md) |
| Testing strategy, E2E, coverage | [Testing Guide](docs/testing.md) |
| Atomic commits, worktrees | [Git Workflow](docs/git-workflow.md) |
| System architecture, components | [Tauri Architecture](docs/tauri-architecture.md) |
| MCP bridge tools | [MCP Tool Reference](docs/mcp-reference.md) |
| Remote debugging, crash analysis | [Debugging Guide](docs/debugging.md) |
| Last.fm scrobbling | [Last.fm Integration](docs/lastfm.md) |
| Cross-platform builds, CI/CD | [Build Configuration](docs/builds.md) |

## Architecture Overview

MT uses a pure Rust + Tauri architecture:

- **Frontend**: Tauri WebView (Alpine.js + Basecoat/Tailwind CSS)
- **Backend**: Native Rust (91 Tauri commands)
- **Audio**: Rodio/Symphonia
- **Database**: SQLite via rusqlite

See [Tauri Architecture](docs/tauri-architecture.md) for full details.

## Queue and Shuffle Behavior

The queue store (`app/frontend/js/stores/queue.js`) maintains tracks in **play order** — the `items` array always reflects the order tracks will be played.

- **Without shuffle**: Tracks play sequentially in the order they were added
- **With shuffle enabled**: The `items` array is physically reordered using Fisher-Yates shuffle
  - Current track moves to index 0
  - Remaining tracks are randomly shuffled
- **When shuffle is disabled**: Original order is restored from `_originalOrder`
- **Loop + Shuffle**: When queue ends with loop=all, items are re-shuffled for a new random order

**Now Playing view**: Always displays tracks in the order they will play (current track first, then upcoming).

## Implementation Notes

1. **Components**: Modular, single-responsibility. Use Alpine.js for interactivity, basecoat/Tailwind for styling.
2. **IPC**: All backend operations via Tauri commands. Use async/await. Emit events for real-time updates.
3. **File Organization**: Frontend in `src/`, backend in `src-tauri/src/`. Keep files under 500 LOC.
4. **Testing**: Unit tests + Playwright E2E. All integration tests MUST use Playwright.
5. **Code Style**: ESLint + Prettier (frontend), `cargo fmt` + `cargo clippy` (backend). Run formatters before committing.

<!-- BACKLOG.MD MCP GUIDELINES START -->

<CRITICAL_INSTRUCTION>

## BACKLOG WORKFLOW INSTRUCTIONS

This project uses Backlog.md MCP for all task and project management.

**CRITICAL RESOURCE**: Read `backlog://workflow/overview` to understand when and how to use Backlog for this project.

- **First time working here?** Read the overview resource IMMEDIATELY to learn the workflow
- **Already familiar?** You should have the overview cached ("## Backlog.md Overview (MCP)")
- **When to read it**: BEFORE creating tasks, or when you're unsure whether to track work

The overview resource contains:

- Decision framework for when to create tasks
- Search-first workflow to avoid duplicates
- Links to detailed guides for task creation, execution, and completion
- MCP tools reference

You MUST read the overview resource to understand the complete workflow. The information is NOT summarized here.

</CRITICAL_INSTRUCTION>

<!-- BACKLOG.MD MCP GUIDELINES END -->
