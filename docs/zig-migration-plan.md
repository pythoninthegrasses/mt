# Rust to Zig Migration Plan

## Overview

This document outlines the plan to migrate business logic from Rust to Zig via FFI, while keeping Tauri as the desktop shell and the AlpineJS/Basecoat frontend unchanged.

### Goals

- Reduce Rust complexity by moving core business logic to Zig
- Leverage Zig's C ABI compatibility for clean FFI boundaries
- Maintain existing Tauri integration layer
- Preserve all existing functionality and tests

### Non-Goals

- Rewriting the frontend
- Replacing Tauri
- Migrating audio playback (remains in Rust due to crate ecosystem)
- Migrating metadata extraction (remains in Rust via lofty crate)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (unchanged)                     │
│              AlpineJS + Basecoat + Vite                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Tauri Shell (Rust)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ commands/*  │  │  events.rs  │  │   media_keys.rs     │  │
│  │ (dispatch)  │  │             │  │   watcher.rs        │  │
│  └──────┬──────┘  └─────────────┘  └─────────────────────┘  │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              ffi/ (Rust FFI bindings)                │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ C ABI
┌─────────────────────────────────────────────────────────────┐
│                    zig-core (Zig)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  scanner/   │  │    db/      │  │     lastfm/         │  │
│  │  metadata   │  │  library    │  │     client          │  │
│  │  fingerprint │  │  queue      │  │     signature       │  │
│  │  artwork    │  │  playlists  │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
mt/
├── Cargo.toml                   # Workspace root
├── crates/
│   ├── mt-core/                 # Zig FFI + pure logic
│   │   ├── Cargo.toml
│   │   ├── build.rs             # Builds Zig, links libmtcore.a
│   │   └── src/
│   │       ├── lib.rs           # Exports ffi module
│   │       └── ffi.rs           # FFI declarations
│   └── mt-tauri/                # Tauri shell (depends on mt-core)
│       ├── Cargo.toml
│       ├── build.rs             # tauri_build only
│       ├── tauri.conf.json
│       └── src/
│           ├── lib.rs           # Re-exports mt_core::ffi
│           ├── commands/        # Tauri command handlers
│           ├── scanner/         # Scanner with FFI wrappers
│           │   ├── artwork_cache_ffi.rs
│           │   ├── inventory_ffi.rs
│           │   └── ...
│           ├── lastfm/          # Last.fm with FFI wrapper
│           │   ├── signature_ffi.rs
│           │   └── ...
│           └── ...
├── zig-core/
│   ├── build.zig
│   ├── src/
│   │   ├── lib.zig              # FFI exports root
│   │   ├── ffi.zig              # C ABI exports
│   │   ├── types.zig            # Shared types
│   │   ├── scanner/
│   │   │   ├── scanner.zig      # Module root
│   │   │   ├── metadata.zig     # Tag extraction (TagLib)
│   │   │   ├── fingerprint.zig  # File change detection
│   │   │   ├── artwork_cache.zig # LRU cache
│   │   │   └── inventory.zig    # Directory scanning
│   │   ├── db/
│   │   │   ├── models.zig       # Data models
│   │   │   ├── library.zig      # Library queries
│   │   │   ├── queue.zig        # Queue management
│   │   │   └── settings.zig     # Settings storage
│   │   └── lastfm/
│   │       ├── client.zig       # HTTP client
│   │       └── types.zig        # API types + signature
│   └── tests/
└── app/frontend/                # Unchanged
```

---

## Layer Classification

### Keep in Rust (Tauri integration)

These files stay in Rust permanently—they're thin dispatch or platform-specific:

| File | Reason |
|------|--------|
| `main.rs` | Tauri bootstrap |
| `lib.rs` | Crate root, adds FFI imports |
| `commands/*.rs` | Thin Tauri command handlers (dispatch to Zig) |
| `dialog.rs` | Tauri dialog APIs |
| `events.rs` | Tauri event system |
| `media_keys.rs` | OS-level media key handling |
| `watcher.rs` | fs notify integration |
| `audio/*.rs` | Audio playback (rodio/cpal ecosystem) |
| `metadata.rs` | Metadata extraction (lofty) |
| `scanner/metadata.rs` | Scanner metadata extraction (lofty) |
| `scanner/artwork.rs` | Artwork extraction (lofty) |

### Migrate to Zig

| File | Target | Notes |
|------|--------|-------|
| ~~`scanner/metadata.rs`~~ | ~~`zig-core/src/scanner/metadata.zig`~~ | ~~TagLib C bindings~~ (FUTURE/EXPERIMENTAL - stays in Rust) |
| `scanner/fingerprint.rs` | `zig-core/src/scanner/fingerprint.zig` | Pure computation |
| ~~`scanner/artwork.rs`~~ | ~~`zig-core/src/scanner/artwork.zig`~~ | ~~Image extraction~~ (FUTURE/EXPERIMENTAL - stays in Rust) |
| `scanner/artwork_cache.rs` | `zig-core/src/scanner/artwork_cache.zig` | Cache management |
| `scanner/inventory.rs` | `zig-core/src/scanner/inventory.zig` | Directory walking |
| `scanner/scan.rs` | `zig-core/src/scanner/scan.zig` | Orchestration |
| ~~`metadata.rs`~~ | ~~`zig-core/src/metadata.zig`~~ | ~~Shared metadata types~~ (FUTURE/EXPERIMENTAL - stays in Rust) |
| `db/models.rs` | `zig-core/src/db/models.zig` | Data structures |
| `db/schema.rs` | `zig-core/src/db/schema.zig` | Schema definitions |
| `db/library.rs` | `zig-core/src/db/library.zig` | Library queries |
| `db/favorites.rs` | `zig-core/src/db/favorites.zig` | Favorites CRUD |
| `db/playlists.rs` | `zig-core/src/db/playlists.zig` | Playlist CRUD |
| `db/queue.rs` | `zig-core/src/db/queue.zig` | Queue state |
| `db/scrobble.rs` | `zig-core/src/db/scrobble.zig` | Scrobble tracking |
| `db/settings.rs` | `zig-core/src/db/settings.zig` | Settings storage |
| `db/watched.rs` | `zig-core/src/db/watched.zig` | Watched folders |
| `lastfm/client.rs` | `zig-core/src/lastfm/client.zig` | HTTP client |
| `lastfm/config.rs` | `zig-core/src/lastfm/config.zig` | Configuration |
| `lastfm/rate_limiter.rs` | `zig-core/src/lastfm/rate_limiter.zig` | Rate limiting |
| `lastfm/signature.rs` | `zig-core/src/lastfm/signature.zig` | API signing |
| `lastfm/types.rs` | `zig-core/src/lastfm/types.zig` | API types |

---

## Migration Order

| Phase | Files | Effort | Risk | Status |
|-------|-------|--------|------|--------|
| 0 | Create `zig-core/`, `build.zig`, `build.rs` integration | 1 day | Low | ✅ Done |
| 1 | ~~`scanner/metadata.rs` → Zig~~ (FUTURE/EXPERIMENTAL) | 2-3 days | Low | ⬜ Deferred |
| 1 | `scanner/fingerprint.rs` → Zig | 1-2 days | Low | ✅ Done |
| 1 | ~~`scanner/artwork.rs` → Zig~~ (stays in Rust via lofty) | 2 days | Low | ⬜ Deferred |
| 1 | `scanner/artwork_cache.rs` → Zig (FFI wired) | 1 day | Low | ✅ Done |
| 1 | `scanner/inventory.rs`, `scan.rs` → Zig (FFI wired) | 2-3 days | Medium | ✅ Done |
| 2 | `db/models.rs`, `db/schema.rs` → Zig | 1 day | Low | ✅ Done |
| 2 | `db/library.rs` → Zig | 2-3 days | Medium | ✅ Done |
| 2 | `db/queue.rs`, `db/playlists.rs`, `db/favorites.rs` → Zig | 2-3 days | Medium | ✅ Done |
| 3 | `lastfm/signature.rs`, `lastfm/types.rs` → Zig | 1 day | Low | ✅ Done |
| 3 | `lastfm/client.rs`, `lastfm/rate_limiter.rs` → Zig | 2-3 days | Medium | ✅ Done |

---

## FFI Conventions

### Memory Ownership

- **Zig allocates, Zig frees**: Functions that return pointers include a corresponding `mt_free_*` function
- **Caller-provided buffers**: For performance-critical paths, use `*_into` variants that write to caller-provided memory
- **Fixed-size structs**: `ExtractedMetadata` uses fixed-size arrays to avoid heap allocation across FFI

### Error Handling

- Functions return `bool` for success/failure when using out-parameters
- Structs include `is_valid` and `error_code` fields
- Error codes defined in `types.ScanError` enum

### Naming Convention

- All FFI exports prefixed with `mt_`
- Zig functions use camelCase internally
- C ABI exports use snake_case

---

## Build Integration

### Workspace Structure

The project uses a Cargo workspace with two crates:
- `mt-core`: Builds Zig library and provides FFI bindings
- `mt-tauri`: Tauri shell that depends on mt-core

### crates/mt-core/build.rs

```rust
use std::path::PathBuf;

fn main() {
    // Get absolute path to workspace root
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let workspace_root = manifest_dir.parent().unwrap().parent().unwrap();
    let zig_core_dir = workspace_root.join("zig-core");
    let zig_lib_dir = zig_core_dir.join("zig-out").join("lib");

    // Build Zig library first
    let status = std::process::Command::new("zig")
        .args(["build", "-Doptimize=ReleaseFast"])
        .current_dir(&zig_core_dir)
        .status()
        .expect("failed to build zig-core");

    assert!(status.success(), "zig-core build failed");

    // Link the static library using absolute path
    println!("cargo:rustc-link-search=native={}", zig_lib_dir.display());
    println!("cargo:rustc-link-lib=static=mtcore");

    // Link TagLib via pkg-config
    pkg_config::Config::new()
        .probe("taglib_c")
        .expect("failed to find taglib_c");

    println!("cargo:rerun-if-changed={}", zig_core_dir.join("src").display());
}
```

### crates/mt-tauri/build.rs

```rust
fn main() {
    tauri_build::build()
}
```

### Dependencies

**macOS:**
```bash
brew install taglib
```

**Linux:**
```bash
apt install libtag1-dev
```

**Windows:**
```powershell
vcpkg install taglib
```

---

## Testing Strategy

### Unit Tests (Zig)

```bash
cd zig-core
zig build test
```

### Integration Tests (Rust)

Existing Rust tests in `src-tauri/src/**/*_test.rs` continue to work, now exercising FFI paths.

### End-to-End (Playwright)

Frontend tests in `app/frontend/tests/*.spec.js` unchanged.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Cross-platform builds | Test CI on macOS, Windows, Linux early |
| Debugging across FFI | Liberal use of `std.log` in Zig; debug builds log all FFI calls |
| Zig stability (pre-1.0) | Pin Zig version in CI; C ABI won't change |
| TagLib availability | Document installation; consider vendoring |
| SQLite version mismatch | Use zig-sqlite's bundled SQLite |

---

## Current Progress

### Completed

- [x] `zig-core/build.zig` - Build system
- [x] `zig-core/src/lib.zig` - Library root
- [x] `zig-core/src/types.zig` - Core types (`ExtractedMetadata`, `FileFingerprint`, etc.)
- [x] `zig-core/src/ffi.zig` - FFI exports (metadata, fingerprint, artwork cache, inventory scanner)
- [x] `zig-core/src/scanner/scanner.zig` - Scanner module root
- [x] `zig-core/src/scanner/metadata.zig` - Metadata extraction with TagLib (FUTURE/EXPERIMENTAL - not active migration, Rust lofty is canonical)
- [x] `zig-core/src/scanner/fingerprint.zig` - File fingerprinting
- [x] `zig-core/src/scanner/artwork_cache.zig` - LRU artwork cache with FFI exports
- [x] `zig-core/src/scanner/inventory.zig` - Inventory scanning (FFI wired)
- [x] `src-tauri/src/ffi.rs` - Rust FFI declarations (incl. inventory scanner)
- [x] `src-tauri/src/scanner/artwork_cache_ffi.rs` - Safe Rust wrapper for Zig artwork cache
- [x] `src-tauri/src/scanner/inventory_ffi.rs` - Safe Rust wrapper for Zig inventory scanner
- [x] `src-tauri/src/scanner/scan.rs` - Now uses Zig FFI for inventory phase
- [x] `src-tauri/tests/ffi_integration.rs` - FFI integration tests (17+ tests)

#### Phase 2: Database Layer (Completed)

- [x] `zig-core/src/db/models.zig` - Database models (Track, Playlist, QueueItem, etc.) with FFI-safe fixed-size buffers
- [x] `zig-core/src/db/library.zig` - Library queries (SearchParams, TrackQueryResult, validation functions)
- [x] `zig-core/src/db/queue.zig` - Queue management (QueueManager, shuffle algorithms, playlist info)
- [x] `zig-core/src/db/settings.zig` - Settings and scrobble tracking (SettingsManager, ScrobbleManager)
- [x] `zig-core/src/ffi.zig` - Extended with db FFI exports (Track, SearchParams, Queue, Settings)
- [x] `src-tauri/src/ffi.rs` - Rust FFI declarations for db layer (36 tests total)

#### Phase 3: Last.fm (Completed)

- [x] `zig-core/src/lastfm/types.zig` - API types (Method, Params, ScrobbleRequest, NowPlayingRequest, ErrorCode) with signature generation
- [x] `zig-core/src/lastfm/client.zig` - HTTP client (Config, RateLimiter, Client, BuiltRequest, ApiResponse) with URL encoding
- [x] `zig-core/src/ffi.zig` - Extended with lastfm FFI exports (client lifecycle, request building, rate limiting, signature)
- [x] `src-tauri/src/ffi.rs` - Rust FFI declarations for lastfm layer (44 tests total)

#### Phase 4: Rust Command Integration (Completed)

- [x] `src-tauri/src/lastfm/signature_ffi.rs` - Safe Rust wrapper for Zig signature generation FFI
- [x] `src-tauri/src/lastfm/client.rs` - Updated to use Zig FFI for API signature generation
- [x] Rate limiter remains in Rust (async-compatible with tokio/reqwest)
- [x] 571 Rust tests pass, 6 new signature FFI tests added

#### Phase 5: Workspace Separation (Completed)

Split single `mt` crate into Cargo workspace for 30-50% faster incremental builds:

- [x] `/Cargo.toml` - Workspace root with shared profile settings
- [x] `/crates/mt-core/` - Zig FFI + pure logic (minimal dependencies)
- [x] `/crates/mt-core/build.rs` - Builds Zig library, links `libmtcore.a`
- [x] `/crates/mt-core/src/ffi.rs` - FFI declarations (moved from src-tauri)
- [x] `/crates/mt-tauri/` - Tauri shell (depends on mt-core)
- [x] `/crates/mt-tauri/build.rs` - Simplified (only tauri_build)
- [x] Updated FFI wrapper imports (`crate::ffi` → `mt_core::ffi`)
- [x] 539 Rust tests pass across workspace

**Incremental Build Isolation:**
- Changes to `mt-tauri/` → Only `mt-tauri` recompiles
- Changes to `mt-core/` → Both crates recompile (correct dependency)

### Next Steps

1. ~~Update `src-tauri/build.rs` to compile Zig first~~ ✅
2. ~~Add `pub mod ffi;` to `src-tauri/src/lib.rs`~~ ✅
3. ~~Test FFI with real audio files~~ ✅
4. ~~Wire artwork_cache FFI~~ ✅
5. ~~Wire `scanner/inventory.rs` to use Zig FFI~~ ✅
6. ~~Wire `scanner/scan.rs` orchestration to use Zig FFI~~ ✅
7. ~~Phase 2: Migrate db/models, db/library, db/queue, db/settings to Zig~~ ✅
8. ~~Phase 3: Migrate lastfm/signature, lastfm/types, lastfm/client, lastfm/rate_limiter to Zig~~ ✅
9. ~~Wire Rust commands to use Zig FFI for Last.fm signature generation~~ ✅
10. ~~Workspace separation for faster incremental builds~~ ✅
11. (Optional) Wire additional database FFI calls as needed for performance-critical paths

---

## Development Workflow

### Building

**Recommended: Use Task Runner**

```bash
# Build everything
task build

# Run all tests (Zig + Rust + Vitest)
task test

# Run only Vitest unit tests
task npm:test

# Run Playwright E2E tests
task test:e2e

# Development mode with hot-reload
task tauri:dev

# Linting (includes Zig formatting check)
task lint

# Formatting (includes Zig)
task format
```

**Zig-Specific Commands**

```bash
# Build zig-core library
task zig:build

# Build zig-core library (release optimized)
task zig:build:release

# Run Zig unit tests
task zig:test

# Run Zig tests with verbose output
task zig:test:verbose

# Format Zig source files
task zig:fmt

# Check Zig formatting (no changes)
task zig:fmt:check

# Clean Zig build artifacts
task zig:clean

# Show Zig build info
task zig:info
```

**Alternative: Low-Level Commands**

```bash
# Build Zig library (called automatically by cargo build)
cd zig-core && zig build

# Build workspace (triggers Zig build via mt-core's build.rs)
cargo build --workspace

# Run Zig tests
cd zig-core && zig build test

# Run Rust tests (all workspace crates)
cargo test --workspace

# Run Vitest unit tests
cd app/frontend && npm test

# Run Playwright E2E tests
cd app/frontend && npm run test:e2e
```

**Test Summary:**
- Zig unit tests: ~50 tests (growing with migration)
- Rust backend: 539 tests (mt-core: 32, mt-tauri: 507)
- Integration tests: 17 tests
- Vitest unit: 213 tests
- Playwright E2E: 413 tests (fast mode, webkit only)
- Total: 1,200+ tests

### Worktree

The Zig migration work is developed in a separate worktree:

```bash
git worktree add ../mt-zig-migration zig-migration
```

This allows parallel development without disrupting the main branch.
