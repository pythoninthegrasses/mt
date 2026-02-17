# Debugging Guide

Remote debugging and crash analysis for the MT music player.

## Linux Remote Debugging

### Running via SSH (headless)

```bash
# Launch with debug logging on a remote Linux host
ssh <HOST> "DISPLAY=:0 RUST_LOG=debug /usr/bin/mt-tauri"

# For Wayland sessions
ssh <HOST> "WAYLAND_DISPLAY=wayland-0 RUST_LOG=debug /usr/bin/mt-tauri"
```

### MCP Bridge (Webview Inspection)

The release .deb is built with the `mcp` Cargo feature by default. This provides full webview inspection over WebSocket (no browser DevTools needed).

> **Note:** `WEBKIT_INSPECTOR_SERVER` does NOT work on release builds. WebKitGTK requires `enable-developer-extras` on the WebView, which Tauri only sets with the `devtools` feature. The MCP bridge is idle until a client connects and provides full webview access.

```bash
# On the Linux host (MCP bridge listens on port 9223)
ssh <HOST> "DISPLAY=:0 /usr/bin/mt-tauri"

# From your development machine, create an SSH tunnel
ssh -L 9223:localhost:9223 <HOST>
```

Then connect via MCP tools:

```javascript
driver_session({ action: "start", port: 9223 })
webview_execute_js({ script: "Alpine.store('library').tracks.length" })
webview_screenshot({ format: "png", filePath: "/tmp/debug.png" })
read_logs({ source: "console", lines: 50 })
```

See the full [MCP Tool Reference](mcp-reference.md) for all available tools.

## Crash Debugging

### 1. Check systemd journal

```bash
ssh <HOST> "journalctl --user --since '10 minutes ago' --no-pager | grep mt-tauri"
```

### 2. Check Ubuntu apport crash reports

```bash
ssh <HOST> "ls -lt /var/crash/ | grep mt"
# Example: _usr_bin_mt-tauri.1000.crash
```

### 3. Unpack and inspect

```bash
ssh <HOST> "apport-unpack /var/crash/_usr_bin_mt-tauri.1000.crash /tmp/mt-crash"
ssh <HOST> "cat /tmp/mt-crash/Signal"       # Signal number (4=SIGILL, 11=SIGSEGV)
ssh <HOST> "cat /tmp/mt-crash/SignalName"    # Human-readable signal name
ssh <HOST> "cat /tmp/mt-crash/ProcStatus"    # Process state at crash
```

### 4. Get a backtrace via gdb

```bash
ssh <HOST> "gdb /usr/bin/mt-tauri /tmp/mt-crash/CoreDump -batch \
  -ex 'bt' -ex 'info registers' -ex 'x/5i \$rip'"
```

### 5. SIGILL: Check CPU feature compatibility

```bash
# What the CPU supports
ssh <HOST> "grep -oP 'flags\s+:\s+\K.*' /proc/cpuinfo | head -1"

# Scan for unsupported instructions
ssh <HOST> "objdump -d /usr/bin/mt-tauri | grep -c 'ymm'"      # AVX (256-bit)
ssh <HOST> "objdump -d /usr/bin/mt-tauri | grep -c 'shlx\|shrx\|sarx'"  # BMI2
```

### Common SIGILL Causes

- Binary compiled with AVX/BMI2 on CI, deployed to older CPUs without those features
- C/C++ static libraries auto-vectorize for the build machine; fix with `-march=x86-64`
