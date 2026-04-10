---
id: TASK-312
title: Containerize macOS self-hosted GitHub Actions runner
status: Done
assignee: []
created_date: '2026-04-06 07:02'
updated_date: '2026-04-10 00:54'
labels:
  - ci
  - infrastructure
  - macos
dependencies: []
references:
  - 'https://github.com/jianliang00/container'
  - 'https://github.com/jianliang00/container/releases/tag/0.0.1'
  - docker/macos/Dockerfile
  - docker/macos/entrypoint.sh
  - scripts/runner.sh
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Containerize the macOS ARM64 self-hosted runner using jianliang00/container (Apple Virtualization framework fork). Replaces bare-metal runner with a reproducible, isolated container image containing all CI dependencies.

The container image packages pre-built tarballs from the host (no network during macOS container builds) including CLT, Homebrew, mise, Node.js, Deno, Task, Rust nightly, cargo tools, and the GitHub Actions runner binary.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Container image builds successfully with `scripts/runner.sh build`
- [x] #2 All tools verified in smoke test (Rust, Node, Deno, Task, Brew, sccache, gh, CLT)
- [ ] #3 Runner registers with GitHub and picks up jobs
- [ ] #4 Existing workflow labels (macOS, ARM64) work without changes
- [x] #5 Build context prepared from host tools via `scripts/runner.sh prepare`
- [x] #6 Linux Dockerfile relocated to docker/linux/Dockerfile with all references updated
- [x] #7 hadolint passes on both Dockerfiles
<!-- AC:END -->
