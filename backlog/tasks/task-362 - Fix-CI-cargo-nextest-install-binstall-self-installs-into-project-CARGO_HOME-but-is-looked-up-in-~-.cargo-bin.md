---
id: TASK-362
title: >-
  Fix CI cargo-nextest install: binstall self-installs into project CARGO_HOME
  but is looked up in ~/.cargo/bin
status: To Do
assignee: []
created_date: '2026-11-13T19:06:00Z'
labels:
  - ci
dependencies: []
references:
  - 'https://github.com/pythoninthegrasses/mt/actions/runs/43487738027'
  - 'https://github.com/pythoninthegrasses/mt/actions/runs/38488090690'
  - taskfiles/ci.yml
priority: high
type: bug
ordinal: 65500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Rust/Zig Shadow-Diff Parity job (and any job using ci:setup-test) fails with `error: no such command: binstall` in ci:_install-cargo-nextest. Cause: the root taskfile.yml sets CARGO_HOME to the project-local .cache/cargo, so `cargo-binstall --self-install` (run by ci:_install-cargo-binstall) installs into .cache/cargo/bin and only appends that dir to GITHUB_PATH for later steps. taskfiles/ci.yml then runs `cargo binstall` with CARGO_HOME="" and PATH={{.CARGO_BIN}} (~/.cargo/bin), where cargo-binstall does not exist. The same pattern affects _install-tauri-cli. Reproduced identically on the pre-toolchain-change run 38488090690 (2026-10-14) and on run 43487738027 (2026-11-13), so it is not caused by the Rust 1.100 pin (TASK-361).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ci:_install-cargo-binstall and the tasks that call cargo binstall agree on where cargo-binstall is installed and looked up
- [ ] #2 ci:setup-test completes on the Linux Blacksmith runner and cargo nextest --version succeeds afterwards
- [ ] #3 ci:_install-tauri-cli has the same fix or is confirmed unaffected
- [ ] #4 Rust/Zig Shadow-Diff Parity job gets past setup (it may still fail later for other tracked reasons)
<!-- AC:END -->
