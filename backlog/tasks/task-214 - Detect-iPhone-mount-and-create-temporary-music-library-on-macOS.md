---
id: TASK-214
title: Detect iPhone mount and create temporary music library on macOS
status: To Do
assignee: []
created_date: '2026-01-27 17:57'
updated_date: '2026-01-27 22:48'
labels:
  - feature
  - macos
  - library
  - usb
dependencies: []
priority: medium
ordinal: 3812.5
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement iPhone mount detection on macOS to enable playing music from mounted iOS devices (e.g., via Doppler app sync).

## Overview

When an iPhone is connected and mounted, detect it via USB enumeration and create a temporary music library from the mounted path (e.g., `~/Music/Doppler`). The temporary library should seamlessly fall back to the permanent library when the device is unplugged.

## Technical Details

### iPhone Detection (macOS)

Use `system_profiler SPUSBDataType` to detect connected iPhones:
- Product ID: `0x12a8`
- Vendor ID: `0x05ac` (Apple Inc.)
- Manufacturer: "Apple Inc."

Example output:
```
iPhone:
    Product ID: 0x12a8
    Vendor ID: 0x05ac (Apple Inc.)
    Version: 14.04
    Serial Number: 0000811000182C1E0AE1801E
    Speed: Up to 480 Mb/s
    Manufacturer: Apple Inc.
    Location ID: 0x08330000 / 22
```

### Key Requirements

1. **USB Detection**: Parse `system_profiler` output to detect iPhone connection/disconnection events
2. **Mount Path Discovery**: Locate the music directory (configurable, default `~/Music/Doppler` - expands `$HOME` at runtime)
3. **Temporary Library**: Create an in-memory or temporary library that:
   - Scans the mounted path for music files
   - Merges with or overlays the permanent library
   - Tracks which files came from the temporary source
4. **Graceful Fallback**: When iPhone is unplugged:
   - Detect missing tracks during playback
   - Suppress orphaned track errors for temporary library files
   - Automatically fall back to permanent library
   - Skip/advance if current track becomes unavailable
5. **Platform-Specific**: macOS only (use `#[cfg(target_os = "macos")]`)

### Implementation Considerations

- Use `IOKit` or periodic `system_profiler` polling for device detection
- Consider using `diskutil` or file system events for mount detection
- May need to handle AFC (Apple File Conduit) protocol for direct device access
- Distinguish between "track missing because unplugged" vs "track genuinely orphaned"
- Use `std::env::var("HOME")` or `dirs::home_dir()` to expand `~` paths at runtime
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 iPhone connection is detected via USB enumeration on macOS
- [ ] #2 Configurable mount path for music files (default: ~/Music/Doppler, expands $HOME at runtime)
- [ ] #3 Temporary library is created when iPhone is mounted
- [ ] #4 Temporary library merges/overlays with permanent library
- [ ] #5 iPhone disconnection is detected automatically
- [ ] #6 Missing track errors are suppressed for temporary library files when device is unplugged
- [ ] #7 Playback falls back gracefully to permanent library on disconnect
- [ ] #8 Feature is gated to macOS only (#[cfg(target_os = "macos")])
- [ ] #9 Unit tests cover detection, mount, and fallback scenarios
<!-- AC:END -->
