# Builds

Build configuration, performance tuning, signing, and distribution for mt.

## Build Strategy

| Platform | Architecture | Runner | Bundle |
| ---------- | ------------- | -------- | -------- |
| macOS | ARM64 | Self-hosted `[macOS, ARM64]` | `.app`, `.dmg` |
| Linux | amd64 | Blacksmith `blacksmith-4vcpu-ubuntu-2404` (configurable, see [CI Runner Policy](#ci-runner-policy)) | `.deb` |
| Windows | x64 | Self-hosted `[self-hosted, Windows, X64]` | `.exe` (NSIS) |

## Taskfile Commands

All `task tauri:*` commands default to nightly with parallel codegen and sccache
(`RUSTUP_TOOLCHAIN=nightly`, `RUSTFLAGS="-Zthreads=16"`, `RUSTC_WRAPPER=sccache`).

| Task | Description |
| ------ | ------------- |
| `task tauri:dev` | Run development server |
| `task tauri:dev:mcp` | Dev server with MCP bridge for AI agent debugging |
| `task tauri:build` | Build for current platform (auto-detects `{{OS}}/{{ARCH}}`) |
| `task tauri:build:arm64` | Build for Apple Silicon (macOS only) |
| `task tauri:build:x64` | Build for Intel x86_64 (macOS only) |
| `task tauri:build:signed` | Build signed + notarized `.app` and `.dmg` (macOS) |
| `task tauri:build:dmg` | Build signed + notarized `.dmg` only (macOS) |
| `task tauri:icons` | Generate app icons from `static/logo.png` |
| `task tauri:build:windows` | Build Windows x64 NSIS `.exe` installer |
| `task tauri:build:linux-amd64` | Build Linux amd64 `.deb` via Docker |
| `task tauri:clean` | Clean all build artifacts |
| `task tauri:clean:rust` | Clean only Rust build artifacts |
| `task tauri:doctor` | Run Tauri environment check |

### Using Stable Toolchain

Override the nightly default if needed:

```bash
# Single command
RUSTUP_TOOLCHAIN=stable RUSTFLAGS="" task tauri:dev

# Or export in shell
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

## Performance

### sccache (`taskfiles/tauri.yml`)

All Tauri build tasks use [sccache](https://github.com/mozilla/sccache) as the Rust compiler wrapper (`RUSTC_WRAPPER=sccache`). sccache caches compiled crate artifacts globally, so new worktrees and clean builds reuse previously compiled objects.

```bash
# Check cache hit rates
sccache --show-stats

# Clear the cache (if needed)
sccache --zero-stats
```

First build populates the cache; subsequent workspaces benefit from cache hits on unchanged crates. This is especially useful with Conductor workspaces where each workspace starts with an empty `target/` directory.

### Dev Profile (`Cargo.toml` workspace root)

```toml
[profile.dev]
split-debuginfo = "unpacked"  # macOS: faster incremental debug builds
debug = "line-tables-only"    # Reduced debug info, still get line numbers in backtraces

[profile.dev.build-override]
opt-level = 3  # Optimize proc-macros and build scripts
```

For full debugging (variable inspection in debuggers), temporarily change to:

```toml
[profile.dev]
debug = true  # or debug = 2 for maximum info
```

### Linker (`crates/mt-tauri/.cargo/config.toml`)

Per-target linker configuration:

```toml
[target.aarch64-apple-darwin]
rustflags = ["-C", "link-arg=-fuse-ld=lld"]

[target.x86_64-apple-darwin]
rustflags = ["-C", "link-arg=-fuse-ld=lld"]

[target.x86_64-unknown-linux-gnu]
rustflags = ["-C", "link-arg=-fuse-ld=mold"]

[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "link-arg=-fuse-ld=lld"]
```

### Linker Options by Platform

#### macOS (ARM64)

| Linker | Status | Notes |
| -------- | -------- | ------- |
| **lld** | Recommended | Currently configured, fast and stable |
| ld-prime | Alternative | Apple's default, similar performance |
| sold | Avoid | Fastest but has codesign issues |

#### Linux

| Linker | Status | Notes |
| -------- | -------- | ------- |
| **mold** | Recommended | Currently configured, fastest option |
| lld | Alternative | Good fallback |

#### Windows

| Linker | Status | Notes |
| -------- | -------- | ------- |
| rust-lld | Recommended | Fast for full builds |
| link.exe | Alternative | Better for tiny incrementals |

### Nightly Toolchain

The `-Zthreads=N` flag enables parallel codegen, which significantly improves incremental build times. This is a nightly-only feature.

### Benchmarks

Measured on Apple M4 Max, macOS 15.7.1:

#### Stable (Rust 1.92.0)

| Scenario | Time | Notes |
| ---------- | ------ | ------- |
| Cold build | ~50.2s | Full rebuild from clean |
| Incremental build | ~1.06s | After touching `src/main.rs` |

#### Nightly + `-Zthreads=16` (Rust 1.95.0-nightly)

| Scenario | Time | Improvement | Notes |
| ---------- | ------ | ------------- | ------- |
| Cold build | ~50.1s | -0.3% | Negligible difference |
| Incremental build | ~0.82s | **-23%** | Significant improvement |

**Key finding**: Nightly with `-Zthreads=16` provides **23% faster incremental builds** with 50x better variance (σ=0.012s vs σ=0.588s), while maintaining full test compatibility (596 Rust tests pass).

### Benchmark Protocol

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

#### Comparing Stable vs Nightly

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

#### Environment Checklist

Before benchmarking, verify:

```bash
rustc -Vv                        # Stable version
RUSTUP_TOOLCHAIN=nightly rustc -Vv  # Nightly version
env | grep RUSTFLAGS             # Check for conflicting flags
env | grep RUSTC_WRAPPER         # Should show sccache (disable with `unset RUSTC_WRAPPER` for raw benchmarks)
```

Ensure consistent power state (AC power, low power mode off).

### Cranelift Backend (Not Supported)

[Cranelift](https://github.com/rust-lang/rustc_codegen_cranelift) is an experimental codegen backend for Rust that can dramatically improve debug build times. However, it is **not compatible with mt** due to SIMD limitations.

Tested on 2026-01-28 with nightly-2026-01-27. Build fails with:

```text
llvm.aarch64.neon.sqdmulh.v2i32 is not yet supported.
See https://github.com/rust-lang/rustc_codegen_cranelift/issues/171
```

This error occurs in multiple Tauri plugin build scripts that use SIMD intrinsics (`tauri-plugin-fs`, `tauri-plugin-store`, `tauri-plugin-shell`, `tauri-plugin-opener`, `tauri-plugin-global-shortcut`).

Per [rustc_codegen_cranelift#171](https://github.com/rust-lang/rustc_codegen_cranelift/issues/171):

- `std::simd` is fully supported
- `std::arch` (platform-specific SIMD intrinsics) is only partially supported
- ARM NEON intrinsics like `sqdmulh` are not yet implemented

**Stick with nightly + `-Zthreads=16`** for now. When Cranelift SIMD support matures (or if Tauri plugins stop using raw NEON intrinsics), reconsider.

```bash
# Testing Cranelift (if revisiting)
rustup component add rustc-codegen-cranelift-preview --toolchain nightly

RUSTUP_TOOLCHAIN=nightly CARGO_PROFILE_DEV_CODEGEN_BACKEND=cranelift \
  cargo build -p mt-tauri -Zcodegen-backend
```

## rust-analyzer (VS Code)

By default, rust-analyzer runs continuous background diagnostics and `cargo check` on every save. On a large workspace this can saturate the CPU even when you haven't changed anything.

### Settings

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `rust-analyzer.checkOnSave` | `true` | Run `cargo check` when a file is saved. Keep enabled for on-save feedback. |
| `rust-analyzer.diagnostics.enable` | `true` | Continuous background analysis (type errors, borrow-check squiggles). Disable to stop builds when nothing has been saved. |
| `rust-analyzer.procMacro.enable` | `true` | Expand procedural macros in the background. Disable to reduce CPU at the cost of missing diagnostics in macro-heavy code. |

### Current override (`.vscode/settings.json`)

```jsonc
"rust-analyzer.diagnostics.enable": false
```

Background diagnostics are disabled. `checkOnSave` remains at its default (`true`), so `cargo check` still runs on each manual save. If you want inline squiggles back but with less background work, swap to disabling only `procMacro.enable` instead.

## Signing & Distribution

### macOS

mt is distributed as a direct download (not via the Mac App Store). This requires:

1. **Code signing** with a Developer ID Application certificate
2. **Notarization** via Apple's notary service (scans for malware, issues a trust ticket)
3. **Stapling** the notarization ticket to the app bundle

Without all three, macOS Gatekeeper blocks the app on users' machines.

#### Prerequisites

- Apple Developer Program membership
- Developer ID Application certificate (created in Xcode or Apple Developer portal)
- App Store Connect API key (for notarization)

#### Environment Variables

All signing secrets are stored in `.env` (loaded via Taskfile dotenv). See `.env.example` for the template.

| Variable | Purpose |
| ---------- | --------- |
| `APPLE_SIGNING_IDENTITY` | Full signing identity string, e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` certificate export |
| `APPLE_CERTIFICATE_PASSWORD` | Password set during `.p12` export |
| `APPLE_API_KEY` | App Store Connect API key ID (10-char alphanumeric) |
| `APPLE_API_ISSUER` | App Store Connect API issuer UUID |
| `APPLE_API_KEY_B64` | Base64-encoded `.p8` private key content |
| `KEYCHAIN_PASSWORD` | CI-only: password for the temporary signing keychain |

#### Entitlements

`crates/mt-tauri/Entitlements.plist` declares hardened runtime entitlements:

| Entitlement | Reason |
| ------------- | -------- |
| `com.apple.security.cs.allow-jit` | WebView/JS engine |
| `com.apple.security.cs.allow-unsigned-executable-memory` | WebView/JS engine |
| `com.apple.security.cs.allow-dyld-environment-variables` | Bundled dylibs |
| `com.apple.security.network.client` | Last.fm API calls |
| `com.apple.security.files.user-selected.read-write` | User-selected music directories |

The app is **not sandboxed** — a music player needs broad filesystem access for library scanning.

#### Local Signed Build

```bash
# Ensure .env is populated with signing secrets
task tauri:build:signed
```

This will:

1. Decode the base64 API key to `/tmp/auth_key.p8`
2. Build the Tauri app for `aarch64-apple-darwin`
3. Sign with the Developer ID certificate
4. Submit to Apple's notary service and wait for approval
5. Staple the notarization ticket
6. Build the DMG installer

#### Verification

```bash
# Verify code signature
codesign --verify --deep --strict \
  target/aarch64-apple-darwin/release/bundle/macos/mt.app

# Verify Gatekeeper acceptance (requires notarization)
spctl --assess --type execute --verbose \
  target/aarch64-apple-darwin/release/bundle/macos/mt.app

# Inspect applied entitlements
codesign -d --entitlements - \
  target/aarch64-apple-darwin/release/bundle/macos/mt.app
```

#### Certificate Management

**Creating a new certificate:**

1. Open Xcode > Settings > Accounts > Manage Certificates
2. Click `+` > Developer ID Application
3. Export as `.p12` from Keychain Access

**Encoding for `.env`:**

```bash
# Certificate (.p12 -> base64)
openssl base64 -A -in cert.p12 | pbcopy

# API key (.p8 -> base64)
openssl base64 -A -in AuthKey_XXXXXXXXXX.p8 | pbcopy
```

**Finding your signing identity:**

```bash
security find-identity -v -p codesigning
```

#### Tauri Configuration

`crates/mt-tauri/tauri.conf.json` macOS bundle config:

```json
"macOS": {
  "minimumSystemVersion": "10.15",
  "entitlements": "./Entitlements.plist",
  "dmg": {
    "windowSize": { "width": 660, "height": 400 },
    "appPosition": { "x": 180, "y": 170 },
    "applicationFolderPosition": { "x": 480, "y": 170 }
  }
}
```

The signing identity is **not** hardcoded in config — Tauri reads `APPLE_SIGNING_IDENTITY` from the environment, so unsigned dev builds still work.

### Linux (.deb)

Linux builds produce `.deb` packages. The bundle target and dependencies are configured in `crates/mt-tauri/tauri.conf.json`:

```json
"bundle": {
  "targets": ["app", "dmg", "deb"],
  "linux": {
    "deb": {
      "depends": ["libwebkit2gtk-4.1-0", "libayatana-appindicator3-1", "libgtk-3-0"],
      "section": "sound"
    }
  }
}
```

Build locally:

```bash
task tauri:build
```

`task tauri:build` auto-detects the current platform via `{{OS}}/{{ARCH}}` and selects the correct Rust target triple.

### Docker Builds (Linux .deb)

Linux amd64 builds use a multi-stage Dockerfile (`docker/Dockerfile.linux-amd64`) for both CI and local builds. The Dockerfile uses [cargo-chef](https://github.com/LukeMathWalker/cargo-chef) to cache compiled dependencies separately from application code.

**Stages:**

| Stage | Purpose | Target |
| --------- | --------- | -------- |
| `deps` | System packages, Rust nightly, Node.js, cargo-chef, tauri-cli | (base) |
| `planner` | `cargo chef prepare` — generates recipe.json from manifests | (internal) |
| `cook` | `cargo chef cook` — compiles all dependencies (cached layer) | (internal) |
| `check` | `cargo check --workspace` | `--target check` (test workflow) |
| `build` | `cargo tauri build` + `cargo tauri bundle` | (internal) |
| `artifacts` | Extract `.deb` and binary | `--target artifacts` (release workflow) |

**CI usage:**

In CI, [Blacksmith Docker layer caching](https://docs.blacksmith.sh/blacksmith-caching/docker-builds) persists all layers on NVMe-backed sticky disks. After the first run, the `deps` and `cook` layers are cached — subsequent runs only rebuild changed source code.

```yaml
# test.yml — cargo check only
- uses: useblacksmith/setup-docker-builder@v1
- uses: useblacksmith/build-push-action@v2
  with:
    target: check

# release.yml — full build + bundle, extract artifacts
- uses: useblacksmith/setup-docker-builder@v1
- uses: useblacksmith/build-push-action@v2
  with:
    target: artifacts
    outputs: type=local,dest=dist
```

**Local usage:**

```bash
# Build .deb via task (QEMU emulation on Apple Silicon)
task build:linux-amd64

# Or build directly with Docker
docker build --platform linux/amd64 --target check -f docker/Dockerfile.linux-amd64 .
docker build --platform linux/amd64 --target artifacts --output type=local,dest=dist -f docker/Dockerfile.linux-amd64 .

# Copy to target machine
scp dist/*.deb zima:~/Downloads/
```

### Windows (NSIS)

Windows builds produce NSIS `.exe` installers with self-signed code signing.

#### Prerequisites

- Visual Studio Build Tools (MSVC v143+, Windows 11 SDK)
- WebView2 runtime (pre-installed on Windows 10 1803+ and Windows 11)
- Chocolatey (for CI dependency management)

#### Bundle Configuration

`crates/mt-tauri/tauri.conf.json` includes `nsis` in bundle targets with per-user + per-machine install support:

```json
"windows": {
  "nsis": {
    "installMode": "both"
  }
}
```

#### Self-Signed Code Signing

CI uses a self-signed certificate generated at build time via `New-SelfSignedCertificate`. This prevents Windows Defender real-time protection false positives but does **not** eliminate SmartScreen "unrecognized app" warnings (that requires an EV certificate with download reputation).

The signing flow:

1. Install Windows SDK (provides `signtool.exe`)
2. Generate a `CodeSigningCert` with subject `CN=MT`
3. Export to PFX with password from `WINDOWS_CERT_PASSWORD` secret
4. Tauri calls `signtool.exe` via `bundle.windows.signCommand` using structured `{ cmd, args }` format to handle spaces in the signtool path (passed as a `--config` override that also disables `beforeBuildCommand`)
5. Both the application binary and NSIS installer are signed
6. DigiCert timestamp server ensures signatures remain valid after cert expiry

#### Environment Variables

| Variable | Purpose |
| ---------- | --------- |
| `WINDOWS_CERT_PASSWORD` | Password for the self-signed PFX certificate (GitHub secret) |

#### Local Build

Use `scripts/build.ps1` from a **native PowerShell terminal** (not git bash — the `Cert:\` drive and certificate cmdlets require the PowerShell Security module, which fails to auto-load under git bash):

```powershell
# Full build with self-signed code signing (recommended)
.\scripts\build.ps1

# Skip dependency installation (faster on subsequent runs)
.\scripts\build.ps1 -SkipDeps

# Build without code signing
.\scripts\build.ps1 -SkipSign

# Clean Rust artifacts before building
.\scripts\build.ps1 -Clean

# Provide your own certificate password
.\scripts\build.ps1 -CertPassword 'my-secret-password'
```

The script replicates the CI pipeline locally:

1. Installs prerequisites via Chocolatey (cmake, rustup, node, go-task, MSVC build tools) — skipped if already present
2. Configures the nightly Rust toolchain and `x86_64-pc-windows-msvc` target
3. Builds the frontend (`npm ci` + `npm run build`) — skips `npm ci` when `node_modules` is already up to date
4. Generates a self-signed `CodeSigningCert` and exports it to a temporary PFX
5. Writes a `sign.cmd` batch wrapper that invokes `signtool.exe sign` with the PFX
6. Calls `npx @tauri-apps/cli build --bundles nsis` with a JSON config override that sets `bundle.windows.signCommand` to `cmd /C sign.cmd %1` (`.cmd` files require `cmd.exe` to execute — they cannot be launched directly via `CreateProcess`)
7. Cleans up the certificate and temp files

Output is written to `target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

> **Note:** Signing with a self-signed certificate prevents Windows Defender false positives but does **not** eliminate SmartScreen "unrecognized publisher" warnings. That requires an EV certificate with established download reputation.

## CI/CD

The release pipeline (`.github/workflows/release.yml`) runs on version tags (`v*`) and manual `workflow_dispatch`.

Three parallel jobs:

### `build-macos` — macOS ARM64

Runs on a self-hosted `[macOS, ARM64]` runner:

1. Imports the certificate into a temporary CI keychain
2. Decodes the `.p8` API key from `APPLE_API_KEY_B64` secret
3. Builds with `tauri-action` which handles signing + notarization
4. Creates a draft GitHub Release with the signed `.dmg`
5. Cleans up the keychain and key file (runs in `always()` step)

### `build-linux-amd64` — Linux amd64

Runs on a configurable Blacksmith runner (default: `blacksmith-4vcpu-ubuntu-2404`, selectable via `linux-runner` workflow input). Uses a containerized build via `docker/Dockerfile.linux-amd64` with Blacksmith Docker layer caching:

1. Sets up the Blacksmith Docker builder (`useblacksmith/setup-docker-builder`)
2. Builds via `useblacksmith/build-push-action` targeting the `artifacts` stage
3. Extracts `.deb` and binary from the container to `dist/`
4. Attaches the `.deb` to the same draft GitHub Release

The test workflow (`test.yml`) uses the same Dockerfile but targets the `check` stage (`cargo check` only).

### `build-windows` — Windows x64

Runs on a self-hosted `[self-hosted, Windows, X64]` runner:

1. Sets up the Tauri build environment (Chocolatey installs cmake and rustup; `~/.cargo/bin` is prepended to `GITHUB_PATH`; `RUSTUP_TOOLCHAIN` is set to the fully qualified `nightly-2026-02-09-x86_64-pc-windows-msvc` to ensure the MSVC-hosted toolchain is used — see [Windows Toolchain Pinning](#windows-toolchain-pinning) below)
2. Installs Windows SDK for `signtool.exe`
3. Generates a self-signed `CodeSigningCert` and exports to PFX
4. Builds the frontend explicitly (`npm run build` in `app/frontend/`)
5. Writes a config override that disables `beforeBuildCommand` (frontend already built) and sets `bundle.windows.signCommand` using structured `{ cmd, args }` format (handles spaces in `signtool.exe` path)
6. Builds with `tauri-action` which calls the sign command for both the binary and NSIS installer
7. Attaches the signed `.exe` to the same draft GitHub Release
8. Cleans up the certificate and config override (runs in `always()` step)

### CI Runner Policy

Runner assignment is optimized for developer iteration speed (PR/push), not release throughput.

| Job | Runner | Rationale |
| ------ | -------- | ----------- |
| `rust` (lint/test) | `[macOS, ARM64]` | Self-hosted, no queue contention |
| `build(macos)` | `[macOS, ARM64]` | Eligible on all ARM64 self-hosted runners |
| `build(linux)` | Blacksmith (configurable) | Containerized via Docker, deps cached by Blacksmith sticky disks |
| `build(windows)` | `[self-hosted, Windows, X64]` | Self-hosted, registry-only cargo cache |
| `deno-lint` | `blacksmith-4vcpu-ubuntu-2404` | Lightweight, vanilla runner |
| `vitest-tests` | `blacksmith-4vcpu-ubuntu-2404` | Lightweight, vanilla runner |
| `playwright-tests` | `[macOS, ARM64]` | Needs WebKit, self-hosted |

**Linux runner toggle:** Both `test.yml` and `release.yml` accept a `linux-runner` workflow_dispatch input. Default is `blacksmith-4vcpu-ubuntu-2404`. To test a different runner label, trigger manually and select from the dropdown. No file edits required for rollback.

**macOS runner broadening:** macOS jobs use `[macOS, ARM64]` (no `studio` pin) so they can schedule on any eligible self-hosted ARM64 runner.

**Lightweight jobs stay on vanilla runners:** `deno-lint` and `vitest-tests` remain on standard Blacksmith runners. Migration to custom images is deferred until a measured benefit is demonstrated.

#### Windows Toolchain Pinning

The self-hosted Windows runner can accumulate stale rustup state across runs. In particular, a system-level settings file (`C:\Windows\system32\config\systemprofile\.rustup\settings.toml`) may set `default_host_triple` to `x86_64-pc-windows-gnu`. When `RUSTUP_TOOLCHAIN` is set to a bare channel name like `nightly-2026-02-09`, rustup resolves it using the default host triple — producing the GNU-hosted toolchain, which requires `dlltool.exe` (not present on MSVC-only runners) and fails with:

```text
error: error calling dlltool 'dlltool.exe': program not found
```

To prevent this, the CI configuration uses three layers of defense:

1. **Fully qualified `RUSTUP_TOOLCHAIN`** (`taskfiles/ci.yml`): On Windows, the env var is set to `nightly-2026-02-09-x86_64-pc-windows-msvc` (with the host triple suffix), eliminating any ambiguity in toolchain resolution.

2. **`rustup set default-host x86_64-pc-windows-msvc`** (`.github/actions/setup-tauri-build/action.yml` and `taskfiles/ci.yml`): Run before toolchain installation to override any stale GNU default.

3. **Explicit `PINNED_RUST` passthrough** (`.github/actions/setup-tauri-build/action.yml`): The composite action extracts the Rust version from `.tool-versions` using PowerShell and passes it to `task ci:setup PINNED_RUST=...`, bypassing the Taskfile's `sh: grep | awk` which may fail when Git Bash utilities aren't in PATH.

## Linux System Dependencies

Tauri on Ubuntu/Debian requires these packages:

```bash
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  libgtk-3-dev \
  libssl-dev \
  pkg-config \
  cmake \
  build-essential \
  mold
```

The `mold` linker is configured in `.cargo/config.toml` for Linux targets. Install it or switch to `lld` if unavailable.

## Linux Runtime Dependencies

The packages above are **build-time** dependencies (headers, dev libraries, compilers). The `.deb` package also declares **runtime** dependencies in `crates/mt-tauri/tauri.conf.json` under `bundle.linux.deb.depends` — these are pulled in automatically when installing the `.deb` via `dpkg` or `apt`.

### Audio: PipeWire ALSA bridge

Debian 13 (trixie), Raspberry Pi OS (bookworm+), and most modern distros use PipeWire as the default audio stack. Applications that output audio via ALSA (like mt, which uses Rodio/Symphonia → ALSA) need `pipewire-alsa` to route audio through PipeWire.

**Without `pipewire-alsa` installed**, ALSA cannot find any usable PCM device and logs errors like:

```text
ALSA lib conf.c:XXX:parse_def Unknown PCM pipewire
ALSA lib conf.c:XXX:parse_def Unknown PCM pulse
ALSA lib conf.c:XXX:parse_def Unknown PCM jack
ALSA lib conf.c:XXX:parse_def Unknown PCM oss
```

The app launches but produces no audio output.

**Fix:** `pipewire-alsa` is declared in the `.deb` depends, so installing the package resolves this automatically:

```bash
sudo apt install ./mt_*.deb   # pulls in pipewire-alsa
```

For manual installs or non-deb distributions:

```bash
# PipeWire-based systems (Debian 13+, Fedora, Arch, etc.)
sudo apt install pipewire-alsa

# PulseAudio-based systems (older Ubuntu/Debian)
sudo apt install libasound2-plugins
```

## Runtime Memory Optimization

The app includes several runtime memory optimizations, particularly important on resource-constrained Linux platforms.

### Frontend: Summary-Only Section Cache

The library store's `_sectionCache` stores only summary metadata (track count, total duration, timestamp) — never full track arrays. Section switching fetches tracks from the local SQLite backend. This prevents duplicate multi-MB track arrays from accumulating in the WebView's JS heap.

- **File**: `app/frontend/js/stores/library.js`
- **Impact**: ~200-400 MB reduction with large libraries

### glibc Malloc Arena Tuning (Linux only)

WebKitGTK spawns multiple processes and threads, each of which can create a glibc malloc arena (~64 MB virtual per arena). Two environment variables are set at Rust startup (before any threads spawn) and inherited by WebKit child processes:

```rust
#[cfg(target_os = "linux")]
unsafe {
    std::env::set_var("MALLOC_ARENA_MAX", "2");
    std::env::set_var("MALLOC_TRIM_THRESHOLD_", "131072");
}
```

- **File**: `crates/mt-tauri/src/lib.rs`
- **Impact**: ~50-100 MB RSS reduction on Linux

### Rayon Thread Pool Limits

The global rayon thread pool is capped at 4 threads with 2 MB stacks (down from per-core threads with 8 MB stacks). Music scanning only needs a few parallel workers.

- **File**: `crates/mt-tauri/src/lib.rs`
- **Impact**: ~12 MB virtual reduction (cross-platform)

### SQLite Connection Pool

The r2d2 pool is sized for a desktop app workload: `max_size(4)`, `min_idle(1)`.

- **File**: `crates/mt-tauri/src/db/mod.rs`

### Artwork Cache

The LRU artwork cache (pure Rust, `lru` + `parking_lot`) is capped at 50 entries via `ArtworkCache::with_capacity(50)`.

- **File**: `crates/mt-tauri/src/lib.rs`

## References

- [Cargo Build Performance](https://doc.rust-lang.org/cargo/guide/build-performance.html)
- [Rust Performance Book - Build Configuration](https://nnethercote.github.io/perf-book/build-configuration.html)
- [Apple ld-prime (WWDC 2023)](https://developer.apple.com/videos/play/wwdc2023/10268/)
- [Rust Unstable Book - threads flag](https://doc.rust-lang.org/unstable-book/compiler-flags/threads.html)
- [Cranelift Codegen Backend](https://github.com/rust-lang/rustc_codegen_cranelift)
- [Cranelift SIMD Tracking Issue](https://github.com/rust-lang/rustc_codegen_cranelift/issues/171)
- [Tauri Bundle Configuration](https://v2.tauri.app/reference/config/#bundleconfig)
- [Apple Developer - Code Signing](https://developer.apple.com/documentation/security/code-signing-services)
