---
id: TASK-313
title: macOS self-hosted runner via Tart VM
status: In Progress
assignee: []
created_date: '2026-04-07 19:40'
updated_date: '2026-04-07 19:47'
labels:
  - ci
  - infrastructure
  - macos
dependencies:
  - TASK-312
references:
  - taskfiles/runner.yml
  - scripts/runner.sh
  - scripts/tart-provision.sh
  - docker/macos/entrypoint.sh
  - 'https://github.com/cirruslabs/tart'
  - 'https://github.com/cirruslabs/macos-image-templates'
documentation:
  - 'https://tart.run'
  - ~/git/moonlight-macos/taskfiles/tart.yml
  - ~/git/ansible_meetup/taskfiles/vagrant.yml
priority: medium
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the jianliang00/container approach (TASK-312) with Tart VMs for the macOS ARM64 self-hosted GitHub Actions runner. The `container` tool is too immature (hangs on build, requires macOS 26 Tahoe, undocumented macOS guest workflow).

Tart is stable (v2.31+), already installed on the host, and has proven patterns from moonlight-macos. The VM has network during provisioning, eliminating the 10GB tarball packaging workflow entirely.

**Approach:** Tart + SSH provisioning script (Option A from analysis). Pull a Cirrus Labs base image, clone it, provision over SSH with a shell script that installs Homebrew packages, mise, Node, Deno, Task, Rust, and the GitHub Actions runner binary. Boot headlessly and register as an ephemeral runner.

**Key differences from TASK-312:**
- No offline tarball packaging (`runner.sh prepare` goes away)
- No Dockerfile — provisioning is a shell script run over SSH
- Cirrus Labs base images include macOS + brew pre-installed
- Tart handles VM lifecycle (clone, run, stop, delete)
- `tart save` can snapshot a provisioned VM for fast startup

**Reusable from TASK-312:**
- `entrypoint.sh` logic (pre-flight checks, signal handling, ephemeral registration loop)
- `runner.sh start` token-fetching loop via `gh api`
- Label analysis: `runs-on: [macOS, ARM64]` works without workflow changes
- `taskfiles/runner.yml` structure (adapt tasks to Tart CLI)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tart VM created from Cirrus Labs base image (sequoia-base or tahoe-base)
- [x] #2 Provisioning script installs all CI tools over SSH (Homebrew packages, mise, Node, Deno, Task, Rust nightly, Actions runner)
- [ ] #3 Runner registers with GitHub and picks up jobs in ephemeral mode
- [x] #4 Existing workflow labels (macOS, ARM64) work without changes to .github/workflows/
- [x] #5 taskfiles/runner.yml updated with Tart lifecycle tasks (pull, create, provision, start, stop, destroy, status)
- [x] #6 runner.sh rewritten for Tart (no tarball packaging, no container build)
- [x] #7 Provisioned VM can be saved as a snapshot for fast startup
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

### Files changed
- `scripts/tart-provision.sh` — NEW: SSH provisioning script installs Homebrew packages, mise, Node, Deno, Task, Rust nightly, Actions runner binary
- `scripts/runner.sh` — REWRITTEN: Tart VM lifecycle (pull/create/provision/save/start/stop/destroy/status/ssh/clean)
- `docker/macos/entrypoint.sh` — ADAPTED: Sources .env from provisioning, runs over SSH instead of as container ENTRYPOINT
- `taskfiles/runner.yml` — REWRITTEN: All tasks mapped to Tart commands, added setup/provision/save/ssh/destroy
- `docker/macos/Dockerfile` — DELETED: No longer needed
- `.gitignore` — Updated comment for tarball gitignore entries
- `AGENTS.md` — Removed hadolint reference to deleted macOS Dockerfile

### Design decisions
- Used `ghcr.io/cirruslabs/macos-sequoia-base:latest` (not xcode variant) since CLT is sufficient for our Rust/Node/Deno toolchain
- Provisioning uses mise for Node/Deno/Task (same as host), rustup directly for Rust (consistent with CI setup action)
- Runner `.env` file provides PATH and env vars for non-interactive job execution
- `tart save` snapshots allow skipping provisioning on subsequent creates
<!-- SECTION:NOTES:END -->
