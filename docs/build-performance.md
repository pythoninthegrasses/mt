# Build Performance Workflow

This document covers build performance optimization for mt development.

## Current Configuration

### Dev Profile (`Cargo.toml` workspace root)

```toml
[profile.dev]
split-debuginfo = "unpacked"  # macOS: faster incremental debug builds
debug = "line-tables-only"    # Reduced debug info, still get line numbers in backtraces

[profile.dev.build-override]
opt-level = 3  # Optimize proc-macros and build scripts
```

### Linker (`crates/mt-tauri/.cargo/config.toml`)

```toml
[build]
rustflags = ["-C", "link-arg=-fuse-ld=lld"]
```

### Nightly Toolchain (`taskfiles/tauri.yml`)

All `task tauri:*` commands default to nightly with parallel codegen:

```yaml
env:
  RUSTUP_TOOLCHAIN: nightly
  RUSTFLAGS: "-Zthreads=16"
```

## Performance Results

Measured on Apple M4 Max, macOS 15.7.1:

### Stable (Rust 1.92.0)

| Scenario | Time | Notes |
|----------|------|-------|
| Cold build | ~50.2s | Full rebuild from clean |
| Incremental build | ~1.06s | After touching `src/main.rs` |

### Nightly + `-Zthreads=16` (Rust 1.95.0-nightly)

| Scenario | Time | Improvement | Notes |
|----------|------|-------------|-------|
| Cold build | ~50.1s | -0.3% | Negligible difference |
| Incremental build | ~0.82s | **-23%** | Significant improvement |

**Key finding**: Nightly with `-Zthreads=16` provides **23% faster incremental builds** with 50x better variance (σ=0.012s vs σ=0.588s), while maintaining full test compatibility (596 Rust tests pass).

## Baseline Protocol

Use [hyperfine](https://github.com/sharkdp/hyperfine) for accurate measurements:

```bash
# Cold build (3 runs with cargo clean before each)
hyperfine --runs 3 --prepare 'cargo clean' \
  'cargo build -p mt-tauri'

# Incremental build (5 runs, 1 warmup)
hyperfine --warmup 1 --runs 5 --prepare 'touch crates/mt-tauri/src/main.rs' \
  'cargo build -p mt-tauri'

# Build timing breakdown (HTML report)
cargo build -p mt-tauri --timings
# Output: target/cargo-timings/cargo-timing.html
```

### Comparing Stable vs Nightly

```bash
# Cold build comparison
hyperfine --runs 3 --prepare 'cargo clean' \
  'cargo build -p mt-tauri' \
  'RUSTUP_TOOLCHAIN=nightly RUSTFLAGS="-Zthreads=16" cargo build -p mt-tauri'

# Incremental build comparison
hyperfine --warmup 1 --runs 5 --prepare 'touch crates/mt-tauri/src/main.rs' \
  'cargo build -p mt-tauri' \
  'RUSTUP_TOOLCHAIN=nightly RUSTFLAGS="-Zthreads=16" cargo build -p mt-tauri'
```

### Environment Checklist

Before benchmarking, verify:

```bash
rustc -Vv                        # Stable version
RUSTUP_TOOLCHAIN=nightly rustc -Vv  # Nightly version
env | grep RUSTFLAGS             # Check for conflicting flags
env | grep RUSTC_WRAPPER         # Should be empty (no sccache)
```

Ensure consistent power state (AC power, low power mode off).

## Linker Options by Platform

### macOS (ARM64)

| Linker | Status | Notes |
|--------|--------|-------|
| **lld** | Recommended | Currently configured, fast and stable |
| ld-prime | Alternative | Apple's default, similar performance |
| sold | Avoid | Fastest but has codesign issues |

### Linux

| Linker | Status | Notes |
|--------|--------|-------|
| **mold** | Recommended | Fastest option |
| lld | Alternative | Good fallback |

```toml
# Linux config (crates/mt-tauri/.cargo/config.toml)
[target.x86_64-unknown-linux-gnu]
rustflags = ["-C", "link-arg=-fuse-ld=mold"]
```

### Windows

| Linker | Status | Notes |
|--------|--------|-------|
| rust-lld | Recommended | Fast for full builds |
| link.exe | Alternative | Better for tiny incrementals |

```toml
# Windows config (crates/mt-tauri/.cargo/config.toml)
[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "link-arg=-fuse-ld=lld"]
```

## Nightly Toolchain

### Why Nightly?

The `-Zthreads=N` flag enables parallel codegen, which significantly improves incremental build times. This is a nightly-only feature.

### Using Stable Instead

If you need to use stable Rust, override the taskfile environment:

```bash
# Single command
RUSTUP_TOOLCHAIN=stable RUSTFLAGS="" task tauri:dev

# Or set in shell
export RUSTUP_TOOLCHAIN=stable
export RUSTFLAGS=""
task tauri:dev
```

### Updating Nightly

```bash
rustup update nightly
```

If a nightly update breaks the build, pin to a specific date:

```bash
rustup install nightly-2026-01-27
# Then update taskfiles/tauri.yml:
# RUSTUP_TOOLCHAIN: nightly-2026-01-27
```

## Debugging with Reduced Debug Info

The `debug = "line-tables-only"` setting provides:
- Line numbers in backtraces
- Faster builds and smaller binaries

For full debugging (variable inspection in debuggers), temporarily change to:

```toml
[profile.dev]
debug = true  # or debug = 2 for maximum info
```

## Quick Reference

```bash
# Development server (uses nightly by default)
task tauri:dev

# Development with stable toolchain
RUSTUP_TOOLCHAIN=stable RUSTFLAGS="" task tauri:dev

# Quick syntax check (no binary, faster than build)
cargo check -p mt-tauri

# Run all tests
task test

# Build timing analysis
task build:timings
```

## Cranelift Backend (Not Supported)

[Cranelift](https://github.com/rust-lang/rustc_codegen_cranelift) is an experimental codegen backend for Rust that can dramatically improve debug build times. However, it is **not compatible with mt** due to SIMD limitations.

### Why Not Cranelift?

Tested on 2026-01-28 with nightly-2026-01-27. Build fails with:

```
llvm.aarch64.neon.sqdmulh.v2i32 is not yet supported.
See https://github.com/rust-lang/rustc_codegen_cranelift/issues/171
```

This error occurs in multiple Tauri plugin build scripts that use SIMD intrinsics:
- `tauri-plugin-fs`
- `tauri-plugin-store`
- `tauri-plugin-shell`
- `tauri-plugin-opener`
- `tauri-plugin-global-shortcut`

### Cranelift SIMD Status

Per [rustc_codegen_cranelift#171](https://github.com/rust-lang/rustc_codegen_cranelift/issues/171):
- `std::simd` is fully supported
- `std::arch` (platform-specific SIMD intrinsics) is only partially supported
- ARM NEON intrinsics like `sqdmulh` are not yet implemented

### Recommendation

**Stick with nightly + `-Zthreads=16`** for now. This provides 23% faster incremental builds without compatibility issues.

When Cranelift SIMD support matures (or if Tauri plugins stop using raw NEON intrinsics), reconsider. Track progress at the issue linked above.

### Testing Cranelift (If Revisiting)

```bash
# Install component
rustup component add rustc-codegen-cranelift-preview --toolchain nightly

# Test build (expects failure currently)
RUSTUP_TOOLCHAIN=nightly CARGO_PROFILE_DEV_CODEGEN_BACKEND=cranelift \
  cargo build -p mt-tauri -Zcodegen-backend
```

## References

- [Cargo Build Performance](https://doc.rust-lang.org/cargo/guide/build-performance.html)
- [Rust Performance Book - Build Configuration](https://nnethercote.github.io/perf-book/build-configuration.html)
- [Apple ld-prime (WWDC 2023)](https://developer.apple.com/videos/play/wwdc2023/10268/)
- [Rust Unstable Book - threads flag](https://doc.rust-lang.org/unstable-book/compiler-flags/threads.html)
- [Cranelift Codegen Backend](https://github.com/rust-lang/rustc_codegen_cranelift)
- [Cranelift SIMD Tracking Issue](https://github.com/rust-lang/rustc_codegen_cranelift/issues/171)
