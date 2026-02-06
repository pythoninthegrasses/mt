---
id: task-259
title: Bundle or statically link TagLib for distribution
status: To Do
assignee: []
created_date: '2026-02-06 23:09'
labels:
  - build
  - distribution
  - macos
dependencies: []
priority: high
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
- [ ] #1 Signed mt.app launches without crash on a machine without Homebrew TagLib installed
- [ ] #2 otool -L shows no /opt/homebrew references in the binary
- [ ] #3 disable-library-validation entitlement removed from Entitlements.plist
<!-- AC:END -->
