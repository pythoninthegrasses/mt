---
id: TASK-355.4
title: 'Package, spawn, and sign the sidecar inside the Tauri bundle'
status: In Progress
assignee: []
created_date: '2026-09-11 00:39'
labels: []
dependencies:
  - TASK-355.3
parent_task_id: TASK-355
type: task
ordinal: 61500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Zig sidecar binary must ship inside the Tauri app bundle via externalBin, be spawned and supervised by the Rust process, and survive macOS notarization as a second signed binary. The key gotcha: Tauri appends the *Rust* host target triple to an externalBin filename to resolve which binary to run, and this does not match Zig's own target naming -- for example a musl-linked Linux build must be named with the suffix `-unknown-linux-gnu` (not `-linux-musl`) and a MinGW-built Windows binary must be named with the suffix `-pc-windows-msvc` (not `-windows-gnu`), because the suffix encodes the consuming Rust host triple, not the ABI the sidecar was actually built with. This mapping must be explicit and hardcoded in the build tooling, never derived by pattern-matching on the Zig target string. git show af04d61 in this repo is prior art for the spawn/lifecycle wiring shape (a prior, later-reverted Python sidecar), useful as a reference for structure even though the transport differs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 externalBin is configured in tauri.conf.json and the Rust-triple filename mapping for each Zig target is explicit in the build tooling, not derived
- [x] #2 The Tauri app spawns the sidecar on startup and terminates it cleanly on app exit
- [x] #3 The app does not panic or crash if the sidecar binary is missing; it fails gracefully with a logged error
- [x] #4 Sidecar stderr output is forwarded into the existing tracing pipeline in crates/mt-tauri/src/logging.rs
- [x] #5 capabilities/default.json is unchanged, since Rust (not JS) owns the sidecar lifecycle
- [x] #6 A CI verification step confirms nested code signatures and the hardened runtime flag on the sidecar binary before the notarization step runs, failing fast on a problem rather than waiting on a 10-minute notarytool round trip (written and wired into release.yml; only executes on the macOS runner, not verified from this Linux dev host — see Implementation Notes)
- [ ] #7 A signed and notarized macOS app bundle successfully launches and the sidecar serves a request from it (deferred to a follow-up; needs a macOS host/CI run)
- [x] #8 The Zig-emitted binary is not stripped or otherwise post-processed after `zig build`, since that would invalidate Zig's ad-hoc code signature on Apple Silicon
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Three decisions were confirmed with Lance before implementation: AC#7 is deferred to a follow-up (this dev host is Linux and cannot honestly verify a signed/notarized macOS bundle); reachability is proven via a Rust-side startup health probe rather than the frontend (355.6's job); the sidecar always spawns on startup with no feature flag, matching AC#2 literally.

**Triple mapping (AC#1, #8).** `taskfiles/zig.yml`'s `stage` task maps a **Rust** host triple to a Zig target via an explicit `case`, since Tauri resolves `externalBin` by appending the Rust triple, not the Zig one, and the two naming schemes genuinely disagree — Zig's bare `x86_64-linux` is static musl, filed under the Rust triple `x86_64-unknown-linux-gnu`. Verified by building each Zig target variant and running `file(1)` on this host: `x86_64-linux` and `x86_64-linux-musl` are both static; `x86_64-linux-gnu` is dynamically linked against `ld-linux`. `zig:stage` builds with `-Doptimize=ReleaseSafe` and copies (never strips) into `crates/mt-tauri/binaries/`. `.gitignore`'s stale `src-tauri/bin/` entry was repointed to `crates/mt-tauri/binaries/`.

**Tauri's build script resolves `externalBin` eagerly**, even for a plain `cargo check` — not just real bundling. This meant `zig:stage` needed to be a hard dependency of `tauri:build`, `tauri:dev`, `tauri:dev:mcp`, and `ci:build` (`taskfiles/tauri.yml`, `taskfiles/ci.yml`), and, independently, of **both** `docker/linux/Dockerfile`'s `check` and `build` stages — they branch separately from `cook`, so fixing only `build` would have left the Docker-based `cargo check` job broken.

**Rust lifecycle** (`crates/mt-tauri/src/sidecar.rs`, new module). No `Drop` impls anywhere in this crate — cleanup is explicit via `RunEvent::Exit` + `try_state`, matching `NetworkFileCache::purge()`'s existing pattern, not the reverted Python sidecar's `Drop`-based shape. Spawn happens in `.setup()` right after `db_path` is resolved; the stale `sidecar.json` is deleted first since the Zig binary has no signal handler and cannot clean it up after a `SIGTERM`/kill. Every failure path (`sidecar()` returning the typed "not configured" error, `spawn()` failing on a missing binary) is logged with `tracing::error!` and `setup()` still returns `Ok(())` — verified by moving the staged binary aside and confirming the app started normally with a logged error, no panic (AC#3). `CommandEvent` output is pumped on `tauri::async_runtime::spawn` under `target: "sidecar"` (stdout/stderr at `info!`, since Zig's `std.log` already prefixes its own level and writes everything to stderr; `Terminated` at `error!` with the exit code) — `logging.rs`'s existing subscriber already renders `target` with zero extra wiring (AC#4). The health probe polls for `sidecar.json`, then issues one authenticated `GET /api/library?limit=1`, async so `setup()` isn't blocked; the resolved `Endpoint` is stored in `SidecarState` for 355.6. `RunEvent::Exit` kills the child idempotently via `take()`; the dead `// Window event handler (sidecar removed in migration)` stub at the old `lib.rs:794` was deleted as actively misleading leftover from the Python-sidecar removal.

**CI (AC#6).** `docker/linux/Dockerfile`'s `deps` stage now installs Zig 0.15.2 (pinned to `.tool-versions`, tarball SHA256 verified against `ziglang.org/download/index.json`). `taskfiles/ci.yml` gained `verify-signing` (`platforms: [darwin]`-guarded, so it no-ops on Linux/Windows), wired into `release.yml`'s `build-macos` job between "Bundle and sign" and "Notarize" — the whole point is failing in seconds on a signing problem rather than after a `notarytool` round trip. It globs `Contents/MacOS/mt-zig-core*` rather than assuming the bundler preserves or strips the triple suffix (Tauri's own docs are silent on this), fails on anything but exactly one match, then asserts `codesign --verify --strict` on the sidecar directly (Apple deprecates `--deep` for verification), greps for the hardened-runtime flag, and re-verifies the `.app`'s nested signatures. This only executes on the macOS runner — not exercised from this Linux dev host, so it stays a "written and wired, unverified here" item, not a checked-and-proven one.

`docs/builds.md`'s CI/CD section was stale, describing a `tauri-action` flow the repo no longer uses; rewrote it against a fresh read of the actual `release.yml` (Task-based for macOS/Windows, pure Docker for Linux) and added a "Sidecar Packaging" subsection. `zig-core/README.md` gained a matching "Packaging, spawning, and signing" section.

**Manual verification**, headless (`sway` with `WLR_BACKENDS=headless WLR_RENDERER=pixman`, since this host has no display server):
- `task build`: sidecar staged and confirmed static/not-stripped (`file` on `crates/mt-tauri/binaries/mt-zig-core-x86_64-unknown-linux-gnu`), `.deb` inspected directly (`ar x` + `tar -t`) and confirmed the sidecar lands at `usr/bin/mt-zig-core` — bare name, Tauri strips the triple suffix on Linux bundling.
- `task test && task lint`: cargo (886 passed, 0 failed), zig, and deno all clean except the pre-existing 17 Vitest failures (`context-menu-favorites`, `go-to-album`, `go-to-artist`, `library.store` — `isRemote is not a function`) and pre-existing clippy findings, both already tracked on TASK-355.1; nothing new in `sidecar.rs`. One rustc nightly ICE ("trying to encode a dep node twice") hit on the first `task test` run — a corrupted incremental-compilation cache from the immediately preceding release build, not a real failure; clearing `target/*/debug/incremental` and rerunning was clean.
- `MT_LOG=debug task tauri:dev` under headless sway: log showed spawn (`Creating sidecar .../mt-zig-core`), the forwarded stdout line under `target=sidecar` (`mt-zig-core listening on 127.0.0.1:<port>`), and `sidecar health probe succeeded port=<port>` in order (AC#2, #4). A raw `kill -TERM` on the app process was tried first and found to *not* exercise the cleanup path — expected, since there's no signal handler and cleanup is tied to `RunEvent::Exit`, not the OS signal — and left `mt-zig-core` orphaned; killed the orphan and re-verified with a real window-close via `swaymsg '[app_id="mt"] kill'` (the Wayland-level equivalent of a user closing the window), which produced `sidecar terminated on exit` and confirmed both processes gone (AC#2).
- Missing-binary run: moved `target/debug/mt-zig-core` aside and ran the built `mt` binary directly — logged `sidecar not started: failed to spawn mt-zig-core error=No such file or directory (os error 2)`, no panic, app started normally (db opened, audio engine up, watchers started) (AC#3). Binary restored afterward.

AC#6/#7 are explicitly not claimed as verified from this run — AC#6 only executes on macOS CI, AC#7 needs a signed+notarized macOS bundle. Both are follow-up work; `release.yml` already exposes `workflow_dispatch` with `platform: macos` to close them without cutting a real release.
<!-- SECTION:NOTES:END -->
