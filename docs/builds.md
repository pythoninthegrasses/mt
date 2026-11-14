# Builds

Build configuration, performance tuning, signing, and distribution for mt.

## Build Strategy

| Platform | Architecture | Runner | Bundle |
| ---------- | ------------- | -------- | -------- |
| macOS | ARM64 | Self-hosted `[macOS, ARM64]` | `.app`, `.dmg` |
| Linux | amd64 | Blacksmith `blacksmith-4vcpu-ubuntu-2404` (configurable, see [CI Runner Policy](#ci-runner-policy)) | `.deb` |
| Windows | x64 | Self-hosted `[self-hosted, Windows, X64]` | `.exe` (NSIS) |

## Taskfile Commands

All `task tauri:*` commands use the Rust version pinned in `.tool-versions` and sccache
(`RUSTUP_TOOLCHAIN` is read from `.tool-versions`, `RUSTC_WRAPPER=sccache`).

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

### Toolchain

The Rust version is pinned to a stable release in `.tool-versions` (`rust 1.100.0`). That file is the single source for the root `taskfile.yml`, `taskfiles/ci.yml`, and the CI composite action. `docker/linux/Dockerfile` (`ARG RUST_VERSION`), `scripts/build.ps1` (`$script:RustToolchain`), and `scripts/runner.sh` (`RUST_TOOLCHAIN`) repeat the value and must be updated by hand.

To try another toolchain for a single command:

```bash
RUSTUP_TOOLCHAIN=nightly task tauri:dev
```

Note that the mise `cargo` shim ignores `RUSTUP_TOOLCHAIN`; when invoking `cargo` outside `task`, call `~/.cargo/bin/cargo` directly.

### Updating Rust

```bash
# 1. Bump the pin
#    .tool-versions, docker/linux/Dockerfile, scripts/build.ps1, scripts/runner.sh
# 2. Install it
mise install rust
# 3. Verify
task lint && task test
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

### Linker

The repo configures no linker, so every platform links with the Rust toolchain default. Stable Rust 1.100 links `x86_64-unknown-linux-gnu` through its bundled `rust-lld` (target spec `linker-flavor: gnu-lld-cc`).

Cargo reads `.cargo/config.toml` relative to the directory it runs from, not the manifest location. Taskfile and Docker run cargo from the repo root, so any linker setting must live in the root `.cargo/config.toml` or an environment variable to take effect. A per-crate `crates/mt-tauri/.cargo/config.toml` was removed because it was never applied.

Linux dev relink after touching `crates/mt-tauri/src/lib.rs`, measured in the Linux Docker image on a 16-core x86_64 host (see TASK-369.7):

| Linker | Relink (mean of 8) |
| -------- | -------- |
| GNU ld | 14.04 s |
| rust-lld (default) | 2.93 s |
| mold | 2.74 s |
| wild | 2.42 s |

Release builds use fat LTO with `codegen-units = 1`, so a relink takes about 100 s with rust-lld, mold or wild alike and the linker choice does not matter. wild supports Linux only and saves about 0.5 s per dev relink, so it was not adopted.

#### Windows

| Linker | Status | Notes |
| -------- | -------- | ------- |
| rust-lld | Recommended | Fast for full builds |
| link.exe | Alternative | Better for tiny incrementals |

### Stable vs Nightly (`-Zthreads`)

mt previously pinned a nightly toolchain only for `-Zthreads=N` (parallel rustc frontend), which has not been stabilized as of Rust 1.100. Measured on Apple M4 Max with sccache disabled (`cargo build -p mt-tauri`, dev profile, 2026-11-13):

| Scenario | Stable 1.100.0 | Nightly 1.102 + `-Zthreads=14` |
| ---------- | ---------------- | -------------------------------- |
| Cold build (3 runs) | 50.3s ± 0.2 | 47.8s ± 0.6 (-5%) |
| Incremental, after touching `src/lib.rs` (5 runs) | 2.17s | 2.17s |

The gap was too small to justify nightly's incremental-cache ICE risk and the extra toolchain pinning, so the repo moved to stable. An earlier measurement on Rust 1.92 vs 1.95-nightly showed 23% faster incremental builds when touching only `src/main.rs`; re-measure if build times become a problem.

### Benchmark Protocol

Use [hyperfine](https://github.com/sharkdp/hyperfine) for accurate measurements.
The scripted version of this protocol lives in `benchmarks/edit-to-run/`
(`bench.sh` for latency/check/disk, `worktree-matrix.sh` for fresh-worktree cost);
re-run it and diff against the newest `results-<date>/` rather than typing the
commands by hand.

```bash
# Cold build (3 runs). Never cargo clean a working target dir: use a throwaway
# worktree, or point CARGO_TARGET_DIR at a scratch directory for the run.
hyperfine --runs 3 --prepare 'cargo clean' \
  'cargo build -p mt-tauri'

# Incremental build (5 runs, 1 warmup). touch only bumps mtime, so it is the
# floor of the range; a real content edit is the number to quote.
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

#### Measured Baseline (TASK-369.1, 2026-11-13)

M4 Max (12P + 4E), 64 GB, macOS 15.8.1, rustc/cargo 1.100.0, sccache warm,
`CARGO_BUILD_JOBS=14`. Means from `benchmarks/edit-to-run/results-2026-11-13/`;
full tables in the TASK-369.1 notes.

| Scenario | `cargo build` | `cargo check` |
| -------- | ------------- | ------------- |
| Real code edit in `mt-tauri` (engine / command wrapper / `lib.rs`) | 2.2s | 1.0s |
| Edit in `main.rs` (bin target, link only) | 0.6s | 0.3s |
| Same edit, `target/debug/incremental` removed | 6.9s | — |
| Frontend-only change (cargo is a no-op) | 0.17s | — |
| Cold full build, `--features agent` | 35.2s | — |

`touch` gives a lower bound (2.2s build / 1.0s check), which is what the
Stable-vs-Nightly table above measured; a real content edit costs the same
because `mt_lib` recompiles as one unit either way. The dev loop also pays
`task zig:stage` (122ms warm, 17–23s cold) — Tauri's `externalBin` resolves
eagerly, so an unstaged sidecar fails the build outright.

Disk: `target/` hits 3.45 GiB on the first `--features agent` debug build and
12.3 GiB after four feature/profile fingerprints accumulate in one long-lived
worktree, 10 GiB of that in `target/debug/build` — the unused
`staticlib`/`cdylib` crate types drop a ~0.5 GiB `libmt_lib.a` plus up to 1 GiB
of stray `mt_lib.*.rcgu.o` per fingerprint. Building with
`crate-type = ["rlib"]` only cut 17s off the debug build, 81s off the release
build, and 1.75 GiB off a worktree. See TASK-369.1 AC#3/AC#4b.

#### Chart-Grid Image Stack Trim (TASK-369.2, 2026-11-13)

`commands/stats.rs` is the only consumer of `image`, `imageproc` and `ab_glyph`.
`imageproc` 0.25 declares `default = ["rayon", "image/default"]`, so feature
unification overrode our `image` codec list and pulled image's whole default
decoder set — the AV1 encoder chain (`rav1e`, `ravif`, `av-scenechange`,
`avif_serialize`), `exr`, `image-webp`, `qoi` — into every build. Setting
`imageproc = { default-features = false }` removes 33 crates, 238 MiB of
artifacts and 27.7s of compile CPU for a four-line `Cargo.toml` change.

Measured with cargo 1.100 on M4 Max, sccache off, one scratch
`CARGO_TARGET_DIR` per scenario, per-unit timings from a `RUSTC_WRAPPER` log
(`--timings=json` is unstable-only). Variance is ~2% CPU / ~2s wall.

| Scenario | crates | compile CPU | wall | `debug/` |
| -------- | ------ | ----------- | ---- | -------- |
| Baseline | 448 | 468.8s | 50.5s | 3655 MiB |
| Feature trim (landed) | 415 | 441.1s | 49.4s | 3417 MiB |
| Also drop `imageproc` | 400 | 443.0s | 49.4s | 3313 MiB |
| Drop all three (canvas renderer) | 381 | 402.1s | 47.5s | 3075 MiB |

Whole-build context: the stack was 7.2% of compile CPU and ~16% of the artifact
tree, but only ~3s of wall time — `syn` (14s), `objc2_app_kit` (13s) and
`darling_core` (11s) own the critical path. This is a disk and crate-count win,
not a latency win. Dropping `imageproc` alone buys 104 MiB and a sub-noise CPU
delta while keeping `image`/`moxcms`/`pxfm`, so it was rejected; dropping all
three requires a canvas renderer plus full-resolution artwork over IPC and stays
on the table as a larger, separate change.

**Do not narrow `image`'s feature list.** `scanner::artwork` reports embedded or
folder art as `image/jpeg|png|gif|bmp|tiff`, and `load_from_memory` decides by
sniffing the bytes, so a missing codec silently degrades that grid cell to its
text placeholder (`stats_generate_chart_grid` logs
`stats.chart_grid` when it happens).
`commands::stats::tests::chart_grid_decodes_every_artwork_mime_type` fails if a
codec is dropped; `chart_grid_golden_image` (run with `GOLDEN_PNG=<path>`)
renders the same 3×3 grid through decode → `resize_exact`/Lanczos3 → overlay →
placeholder → PNG for before/after comparison.

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

**Stick with the stable LLVM backend** for now. When Cranelift SIMD support matures (or if Tauri plugins stop using raw NEON intrinsics), reconsider.

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

Linux amd64 builds use a multi-stage Dockerfile (`docker/linux/Dockerfile`) for both CI and local builds. The Dockerfile uses [cargo-chef](https://github.com/LukeMathWalker/cargo-chef) to cache compiled dependencies separately from application code.

**Stages:**

| Stage | Purpose | Target |
| --------- | --------- | -------- |
| `deps` | System packages, Rust (pinned), Node.js, cargo-chef, tauri-cli | (base) |
| `planner` | `cargo chef prepare` — generates recipe.json from manifests | (internal) |
| `cook` | `cargo chef cook` — compiles all dependencies (cached layer) | (internal) |
| `check` | `cargo check --workspace` | `--target check` (test workflow) |
| `build` | `cargo tauri build` + `cargo tauri bundle` | (internal) |
| `artifacts` | Extract `.deb` and binary | `--target artifacts` (release workflow) |

**CI usage:**

In CI, [Blacksmith Docker layer caching](https://docs.blacksmith.sh/blacksmith-caching/docker-builds) persists all layers on NVMe-backed sticky disks. After the first run, the `deps` and `cook` layers are cached — subsequent runs only rebuild changed source code.

The test workflow (`test.yml`) uses a hash-based skip optimization: before spinning up Docker, it computes a hash of all files that affect `cargo check` output (`Cargo.toml`, `Cargo.lock`, `crates/**/*.rs`, crate manifests, cargo config, and the Dockerfile). If the hash matches a previous successful run (via `actions/cache`), the entire Docker build is skipped. This eliminates ~65s of Docker orchestration overhead on runs where Rust source hasn't changed — reducing the Linux job from ~75s to ~5s on cache hit.

```yaml
# test.yml — cargo check only (with hash-based skip)
- uses: actions/cache@v4        # check if inputs changed
- uses: useblacksmith/setup-docker-builder@v1  # skip if cache hit
- uses: useblacksmith/build-push-action@v2     # skip if cache hit
  with:
    target: check

# release.yml — full build + bundle, extract artifacts (no skip)
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
docker build --platform linux/amd64 --target check -f docker/linux/Dockerfile .
docker build --platform linux/amd64 --target artifacts --output type=local,dest=dist -f docker/linux/Dockerfile .

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
2. Configures the pinned Rust toolchain and `x86_64-pc-windows-msvc` target
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

All three jobs package the `zig-core` sidecar into the app bundle via Tauri's
`externalBin` (see [Sidecar Packaging](#sidecar-packaging) below) — they
install the pinned Zig toolchain before building, and `task ci:build`
stages the sidecar for the job's target as a hard dependency.

### `build-macos` — macOS ARM64

Runs on a self-hosted `[macOS, ARM64]` runner:

1. Imports the certificate into a temporary CI keychain
2. Decodes the `.p8` API key from `APPLE_API_KEY_B64` secret
3. Reads the pinned Zig version from `.tool-versions`, restores its build cache, and installs it (`mlugg/setup-zig@v2`)
4. `task ci:build TARGET=aarch64-apple-darwin` — stages the sidecar (`zig:stage`) then builds the app binary
5. `task ci:bundle TARGET=aarch64-apple-darwin` — bundles and signs the `.app`, including the sidecar
6. `task ci:verify-signing TARGET=aarch64-apple-darwin` — verifies the sidecar's code signature and hardened runtime flag before notarizing, so a signing problem fails in seconds rather than after a ~10-minute `notarytool` round trip
7. `task ci:notarize TARGET=aarch64-apple-darwin` — notarizes and staples the signed `.dmg`
8. Creates a draft GitHub Release with the signed, notarized `.dmg`
9. Cleans up the keychain and key file (runs in `always()` step)

### `build-linux-amd64` — Linux amd64

Runs on a configurable Blacksmith runner (default: `blacksmith-4vcpu-ubuntu-2404`, selectable via `linux-runner` workflow input). Uses a containerized build via `docker/linux/Dockerfile` with Blacksmith Docker layer caching:

1. Sets up the Blacksmith Docker builder (`useblacksmith/setup-docker-builder`)
2. Builds via `useblacksmith/build-push-action` targeting the `artifacts` stage — the Dockerfile's `deps` stage installs the pinned Zig toolchain directly (checksum-verified tarball from `ziglang.org`, since this runs inside the container rather than through a GitHub Action), and both the `check` and `build` stages build+stage the sidecar (`mt-zig-core-x86_64-unknown-linux-gnu`) before `cargo check`/`cargo tauri build`
3. Extracts `.deb` and binary from the container to `dist/`
4. Attaches the `.deb` to the same draft GitHub Release

The test workflow (`test.yml`) uses the same Dockerfile but targets the `check` stage (`cargo check` only).

### `build-windows` — Windows x64

Runs on a self-hosted `[self-hosted, Windows, X64]` runner:

1. Sets up the Tauri build environment (Chocolatey installs cmake and rustup; `~/.cargo/bin` is prepended to `GITHUB_PATH`; `RUSTUP_TOOLCHAIN` is set to the fully qualified `1.100.0-x86_64-pc-windows-msvc` to ensure the MSVC-hosted toolchain is used — see [Windows Toolchain Pinning](#windows-toolchain-pinning) below)
2. Installs Windows SDK for `signtool.exe`
3. Generates a self-signed `CodeSigningCert` and exports to PFX
4. Writes a config override that disables `beforeBuildCommand` and sets `bundle.windows.signCommand` using structured `{ cmd, args }` format (handles spaces in `signtool.exe` path)
5. Reads the pinned Zig version from `.tool-versions`, restores its build cache, and installs it (`mlugg/setup-zig@v2`)
6. `task ci:build TARGET=x86_64-pc-windows-msvc CONFIG=<sign override>` — stages the sidecar (`zig:stage`) then builds the app binary, signed via the override's `signCommand`
7. `task ci:bundle TARGET=x86_64-pc-windows-msvc BUNDLES=nsis CONFIG=<sign override>` — bundles the signed NSIS installer, including the sidecar
8. Attaches the signed `.exe` to the same draft GitHub Release
9. Cleans up the certificate and config override (runs in `always()` step)

### Sidecar Packaging

`crates/mt-tauri/tauri.conf.json`'s `bundle.externalBin` names the sidecar
(`binaries/mt-zig-core`); Tauri resolves the on-disk file by appending the
*Rust* host triple, e.g. `binaries/mt-zig-core-aarch64-apple-darwin`. The
`zig:stage` Task (`taskfiles/zig.yml`) builds `zig-core` for the Zig target
matching that Rust triple — via an explicit hardcoded table, since Zig and
Rust triple naming schemes disagree (e.g. Zig's `x86_64-linux` is static
musl, filed under the Rust triple `x86_64-unknown-linux-gnu`) — and copies
(never strips) the result into `crates/mt-tauri/binaries/`.

Because Tauri's build script resolves `externalBin` paths eagerly, even a
plain `cargo check` on `mt-tauri` requires the sidecar to already be staged
for the host's Rust triple. `ci:build`, `tauri:build`, and `tauri:dev` all
carry a `zig:stage` dependency for exactly this reason.

Jobs that only compile or test Rust and never execute the sidecar (the `rust` job and `ci:check`, which backs the macOS and Windows `build` matrix legs) stage an empty stand-in with `task zig:stage-placeholder TARGET=<rust-triple>` instead of a real binary. This keeps Zig installation, Zig build time and Zig-side failures off their critical path, and the task never overwrites an existing file, so a real `zig:stage` output survives. The stub is written before any cargo invocation, so a failure there stops the job before the build script can rewrite the tracked `crates/mt-tauri/gen/schemas/*.json`. Tests that spawn the real sidecar (`shadow_diff_parity_test::`) cannot run against the stand-in; the `rust` job excludes them with a nextest filter and the `shadow-diff` job runs them with real Zig.

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

#### Test Workflow Dependency Graph

The test workflow (`test.yml`) runs eight jobs. The fast jobs (`deno-lint`, `rust`, `vitest-tests`, `zig`) gate the expensive ones, so a failure in any of them skips the build matrix, Playwright and shadow-diff:

```text
deno-lint    ──► build(macos, linux, windows)
rust         ──► build(macos, linux, windows)
vitest-tests ──► build(macos, linux, windows)
zig          ──► build(macos, linux, windows)
deno-lint    ──► playwright-tests (also gated on `changes`: frontend-paths filter)
rust         ──► playwright-tests
vitest-tests ──► playwright-tests
zig          ──► playwright-tests
zig          ──► shadow-diff (continue-on-error)

changes      (independent — feeds playwright-tests' path filter only)
```

The `rust` job does not produce artifacts consumed by the build matrix (`cargo check` per platform); `build` waits on the fast jobs only to avoid spending runner time on a commit that already fails lint, format or tests, which costs up to ~15-20 min of added wall-clock on the build matrix. `playwright-tests` runs against a Vite preview build with mocked IPC rather than any Tauri/Rust artifact, but waits on the same jobs for the same reason. `shadow-diff` waits on `zig` so a broken Zig build skips its 25-minute run; it stays `continue-on-error` so a parity divergence never blocks an unrelated change.

#### CI Setup Modes

The composite action `.github/actions/setup-tauri-build/action.yml` accepts a `mode` input that controls which dependencies are installed:

| Mode | Node.js | `npm ci` | cargo-binstall | tauri-cli | Taskfile target | Use case |
|------|---------|----------|----------------|-----------|-----------------|----------|
| `full` (default) | Yes | Yes | Yes | Yes | `ci:setup` | Release builds, `cargo tauri build` |
| `check` | No | No | No | No | `ci:setup-check` | `cargo check`, `cargo clippy`, `cargo nextest` |

The `check` mode skips Node.js, frontend dependencies, and cargo tools (cargo-binstall, tauri-cli) because `cargo check` and `cargo clippy` only need the Rust toolchain and system libraries. The `tauri_build::build()` build script reads config files but does not require the frontend `dist/` directory for check-only compilation.

Jobs using `mode: check` in `test.yml`: `rust` (lint/test) and `build` matrix (cross-platform `cargo check`).

On Windows, the composite action also bootstraps `git` and `pwsh` via Chocolatey if they are missing from the runner image. This runs before all other steps (using `shell: powershell` for compatibility with bare images) so that `actions/checkout` can use system git and subsequent `pwsh`-shell steps work. The bootstrap is idempotent — it skips installation when the tools are already present.

#### Windows Toolchain Pinning

The self-hosted Windows runner can accumulate stale rustup state across runs. In particular, a system-level settings file (`C:\Windows\system32\config\systemprofile\.rustup\settings.toml`) may set `default_host_triple` to `x86_64-pc-windows-gnu`. When `RUSTUP_TOOLCHAIN` is set to a bare toolchain name like `1.100.0`, rustup resolves it using the default host triple — producing the GNU-hosted toolchain, which requires `dlltool.exe` (not present on MSVC-only runners) and fails with:

```text
error: error calling dlltool 'dlltool.exe': program not found
```

To prevent this, the CI configuration uses three layers of defense:

1. **Fully qualified `RUSTUP_TOOLCHAIN`** (`taskfiles/ci.yml`): On Windows, the env var is set to `1.100.0-x86_64-pc-windows-msvc` (with the host triple suffix), eliminating any ambiguity in toolchain resolution.

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
  build-essential
```

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
