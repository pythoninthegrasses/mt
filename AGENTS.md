# AGENTS.md

This file provides guidance to LLMs when working with code in this repository.

## Project Overview

mt is a desktop music player designed for large music collections, built with Tauri (Rust backend), basecoat (with Tailwind CSS), and Alpine.js. The backend uses Rust for audio playback and system integration, while the frontend is a modern web-based UI with reactive components.

## General Guidelines

- ALWAYS use atomic commits — see [Git Workflow](docs/git-workflow.md) for interactive staging, patch mode, and worktree management
- NEVER create *.backup files. This is a version controlled repo

## Context7

Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.

### Libraries

- alpinejs/alpine
- cranot/roam-code
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
| Local GitHub Actions testing | [act Guide](docs/act-guide.md) |
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
- **Build Cache**: sccache (shared across worktrees/workspaces)

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
3. **File Organization**: Frontend in `app/frontend/`, backend in `src-tauri/src/`. Keep files under 500 LOC.
4. **Testing**: Unit tests + Playwright E2E. All integration tests MUST use Playwright.
5. **Code Style**: `deno lint` + `deno fmt` (frontend), `cargo fmt` + `cargo clippy` (backend). Run formatters before committing.

## Codebase navigation

This project uses `roam` for codebase comprehension. Always prefer roam over Glob/Grep/Read exploration.

Before modifying any code:

1. First time in the repo: `roam understand` then `roam tour`
2. Find a symbol: `roam search <pattern>`
3. Before changing a symbol: `roam preflight <name>` (blast radius + tests + fitness)
4. Need files to read: `roam context <name>` (files + line ranges, prioritized)
5. Debugging a failure: `roam diagnose <name>` (root cause ranking)
6. After making changes: `roam diff` (blast radius of uncommitted changes)

Additional: `roam health` (0-100 score), `roam impact <name>` (what breaks),
`roam pr-risk` (PR risk), `roam file <path>` (file skeleton).

Run `roam --help` for all commands. Use `roam --json <cmd>` for structured output.

<!-- BACKLOG.MD MCP GUIDELINES START -->

<CRITICAL_INSTRUCTION>

## BACKLOG WORKFLOW INSTRUCTIONS

This project uses Backlog.md MCP for all task and project management.

**CRITICAL RESOURCE**: Read `backlog://workflow/overview` to understand when and how to use Backlog for this project.

- **First time working here?** Read the overview resource IMMEDIATELY to learn the workflow
- **Already familiar?** You should have the overview cached ("## Backlog.md Overview (MCP)")
- **When to read it**: BEFORE creating tasks, or when you're unsure whether to track work

### Key MCP Commands

| Command | Purpose |
|---------|---------|
| `task_create` | Create a new task (status defaults to "To Do") |
| `task_edit` | Edit metadata, check ACs, update notes, change status |
| `task_view` | View full task details |
| `task_search` | Find tasks by keyword |
| `task_list` | List tasks with optional filters |
| `task_complete` | **Moves task to `backlog/completed/`** — only use for cleanup, not for marking done |

### Task Lifecycle

1. **Create**: `task_create` — new task in `backlog/tasks/`
2. **Start**: `task_edit(status: "In Progress")` — mark as active
3. **Done**: `task_edit(status: "Done")` — mark finished, stays in `backlog/tasks/` (visible on kanban)
4. **Archive**: `task_complete` — moves to `backlog/completed/` (use only when explicitly cleaning up)

**IMPORTANT**: Use `task_edit(status: "Done")` to mark tasks as done. Do NOT use `task_complete` unless the user explicitly asks to archive/clean up — it removes the task from the kanban.

The overview resource contains additional detail on decision frameworks, search-first workflow, and guides for task creation, execution, and completion.

</CRITICAL_INSTRUCTION>

<!-- BACKLOG.MD MCP GUIDELINES END -->
