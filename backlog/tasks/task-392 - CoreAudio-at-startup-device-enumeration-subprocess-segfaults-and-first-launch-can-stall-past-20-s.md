---
id: TASK-392
title: >-
  CoreAudio at startup: device-enumeration subprocess segfaults and first launch
  can stall past 20 s
status: To Do
assignee:
  - lance
created_date: '2026-11-14T17:58:00Z'
updated_date: '2026-11-15T05:40:00Z'
labels:
  - bugfix
  - audio
  - native-adapter
dependencies: []
references:
  - crates/mt-tauri/src/audio/device_isolation.rs
  - benchmarks/release-profile/smoke.sh
  - docs/builds.md
priority: medium
ordinal: 78500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while running the TASK-369.4 playback smoke on this machine. Two related symptoms, both profile-independent (they reproduce on fat-LTO and lto=false binaries), so they are not a release-profile issue:

1. The device-enumeration subprocess (MT_ENUMERATE_DEVICES=1, spawned by safe_list_output_devices) segfaults consistently in CoreAudio HALDeviceList::GetData (crash report: EXC_BAD_ACCESS / KERN_INVALID_ADDRESS at 0x4, inside AudioObjectGetPropertyData_mac_imp). The subprocess isolation works as designed -- the app survives -- but the device list the app wants never arrives, so the output-device picker is likely always empty on affected machines.
2. First launch is flaky: in three of six smoke runs the app logged 'Tracing initialized' and then produced nothing for the full 20 s window -- no mt.db, no further stdout. resolve_device uses a 5 s timeout, so a single device wait does not explain it; something in startup (audio engine init via cpal, or repeated device waits) can block for much longer. A music player that sometimes takes 20+ s to reach a usable state is a user-visible bug regardless of the smoke harness.

The machine this was observed on had a wedged coreaudiod (11 days uptime, ~10% CPU, afplay also hung) which was killed and restarted mid-investigation; the segfault reproduced AFTER the restart with working playback, and the stall did not fully go away. reproduce before/after a coreaudiod restart to separate environment from code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reproduce or rule out the enumeration subprocess segfault outside the smoke harness (direct MT_ENUMERATE_DEVICES=1 run, crash report captured) and identify the cpal/CoreAudio call that crashes
- [ ] #2 Reproduce or rule out the startup stall: instrument first launch (tracing spans around db init and audio engine init) and capture which stage blocks when it blocks
- [ ] #3 The output-device picker either lists devices or the UI degrades explicitly when enumeration fails, instead of silently showing an empty list
- [ ] #4 First launch reaches db-created within the smoke's 20 s window reliably, or the blocking stage is made async/timeout-bounded so it cannot stall startup
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-14 Zig-first scheduling: remains eligible during the feature freeze. Diagnose/fix the current Rust CPAL/CoreAudio/native startup capability; do not wait for or bundle a Zig audio rewrite. TASK-393.13 must preserve this fix and its failure behavior. No release-profile/cache benchmark matrix is required.
<!-- SECTION:NOTES:END -->
