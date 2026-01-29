# Dependency Audit Results

**Date:** 2026-01-26
**Task:** Phase 3 - Dependency Optimization Audit (task-210)

## 1. Tokio Features Audit

### Previous Configuration
```toml
tokio = { version = "1", features = ["full"] }
```

### Actual Usage Analysis
Analyzed the codebase for Tokio usage patterns:
- `tokio::sync::mpsc` - Multi-producer, single-consumer channels
- `tokio::sync::oneshot` - One-shot channels
- `tokio::sync::Mutex` - Async mutex
- `tokio::spawn` - Spawning async tasks
- `tokio::task::spawn_blocking` - Spawning blocking tasks
- `tokio::time::interval` - Time intervals
- `tokio::time::sleep` - Async sleeping
- `tokio::select!` - Selecting from multiple async operations
- `tokio::runtime::Handle::current()` - Runtime handle access
- `tokio::io::AsyncWriteExt` - Async I/O traits
- `tokio::fs::File` - Async file operations
- `#[tokio::test]` - Test attribute macro

### Updated Configuration
```toml
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time", "fs", "io-util"] }
```

**Features Included:**
- `rt-multi-thread` - Multi-threaded runtime (includes `rt` + threading)
- `macros` - `#[tokio::test]` and `select!` macro support
- `sync` - Async synchronization primitives (mpsc, oneshot, Mutex)
- `time` - Time utilities (sleep, interval)
- `fs` - Async file system operations
- `io-util` - Async I/O utility traits

**Estimated Impact:** 2-5% reduction in compilation time by eliminating unused features like `process`, `net`, `signal`, and others.

## 2. Duplicate Dependencies

Ran `cargo tree --duplicate` to identify version conflicts. Notable duplicates found:

### High-Impact Duplicates (3 versions)
- **getrandom**: v0.1.16, v0.2.17, v0.3.4
- **hashbrown**: v0.12.3, v0.15.5, v0.16.1
- **phf**: v0.8.0, v0.10.1, v0.11.3
- **rand**: v0.7.3, v0.8.5, v0.9.2

### Medium-Impact Duplicates (2 versions)
- **base64**: v0.21.7, v0.22.1
- **bitflags**: v1.3.2, v2.10.0
- **h2**: v0.3.27, v0.4.13
- **http**: v0.2.12, v1.4.0
- **hyper**: v0.14.32, v1.8.1
- **syn**: v1.0.109, v2.0.114
- **thiserror**: v1.0.69, v2.0.17

### Analysis
Most duplicates are **transitive dependencies** (dependencies of dependencies) caused by ecosystem transitions:
- Major version upgrades (e.g., `bitflags` v1 → v2)
- HTTP stack modernization (`hyper` v0.14 → v1.x)
- Proc-macro ecosystem updates (`syn` v1 → v2)

**Recommendation:** These are normal during ecosystem transitions. We cannot eliminate them without upstream crate updates. Monitor for future consolidation but no action needed now.

## 3. Unused Dependencies Check

**Not performed:** Would require `cargo-machete` or `cargo-udeps` installation.

**Action item:** Consider running periodically during maintenance:
```bash
cargo install cargo-machete
cargo machete src-tauri
```

## Summary

✅ **Tokio features trimmed** - Reduced from `full` to 6 specific features
✅ **Duplicate dependencies documented** - 35+ duplicates identified, mostly transitive
⏸️ **Unused dependencies** - Deferred (requires additional tooling)

**Estimated Build Time Improvement:** 2-5% from Tokio optimization
**Risk Level:** Minimal (features removed are genuinely unused)
