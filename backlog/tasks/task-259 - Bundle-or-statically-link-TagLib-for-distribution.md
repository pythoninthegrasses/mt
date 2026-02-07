---
id: TASK-259
title: Bundle or statically link TagLib for distribution
status: Done
assignee: []
created_date: '2026-02-06 23:09'
updated_date: '2026-02-07 01:45'
labels:
  - build
  - distribution
  - macos
dependencies: []
priority: high
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The signed mt.app crashes on launch because the binary dynamically links `/opt/homebrew/opt/taglib/lib/libtag_c.2.dylib`. This works on the developer's machine but fails for distribution: (1) users without Homebrew TagLib get a missing library crash, and (2) the hardened runtime rejects the dylib due to different Team IDs (mitigated by `disable-library-validation` entitlement as a stopgap).

The binary references these Homebrew dylibs at runtime:
- `/opt/homebrew/opt/taglib/lib/libtag_c.2.dylib`
- `/opt/homebrew/opt/taglib/lib/libtag.2.dylib`

Root cause: `zig-core/build.zig` uses `.use_pkg_config = .force` which links dynamically, and `crates/mt-core/build.rs` uses `pkg_config::Config::new().probe("taglib_c")` which also resolves to dynamic linking.

Options (pick one):
1. **Static linking** (preferred): Change `build.zig` to link TagLib statically and update `mt-core/build.rs` to use `cargo:rustc-link-lib=static=tag_c`. Eliminates runtime dependency entirely.
2. **Bundle dylibs**: Copy libtag_c.dylib + libtag.dylib into `mt.app/Contents/Frameworks/`, use `install_name_tool -change` to rewrite load paths, sign bundled dylibs with the same Developer ID identity.

Once resolved, the `com.apple.security.cs.disable-library-validation` entitlement in `Entitlements.plist` can be removed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Signed mt.app launches without crash on a machine without Homebrew TagLib installed
- [x] #2 otool -L shows no /opt/homebrew references in the binary
- [x] #3 disable-library-validation entitlement removed from Entitlements.plist
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Statically linked TagLib 2.0.2 into the mt binary, eliminating the runtime dependency on Homebrew's dynamic libraries.

## Changes
- `scripts/build-taglib.sh` - New script to download TagLib source and build static `.a` libraries into `vendor/taglib/`
- `zig-core/build.zig` - Replaced `use_pkg_config = .force` with explicit vendor include/library paths
- `crates/mt-core/build.rs` - Static linking directives for `tag_c`, `tag`, `z`, `c++`; auto-triggers build script if vendor libs missing
- `crates/mt-core/Cargo.toml` - Removed `pkg-config` build dependency
- `crates/mt-tauri/Entitlements.plist` - Removed `disable-library-validation` entitlement
- `.github/actions/setup-tauri-build/action.yml` - Replaced `brew install taglib` with `scripts/build-taglib.sh`
- `.github/workflows/test.yml` - Updated diagnostic echo for static TagLib
- `taskfiles/zig.yml` - Added `zig:build:taglib` and `zig:build:taglib:force` tasks
- `.gitignore` - Added `vendor/`

## Verification
- `otool -L` shows zero `/opt/homebrew` references
- `codesign --verify --deep --strict` passes (exit 0)
- `codesign -d --entitlements` confirms no `disable-library-validation`
- 596 Rust tests pass, Zig tests pass
<!-- SECTION:FINAL_SUMMARY:END -->
