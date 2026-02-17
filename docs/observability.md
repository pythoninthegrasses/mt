# Observability

Structured logging and diagnostics for mt.

## Crate Stack

| Crate                | Role                                            |
|----------------------|-------------------------------------------------|
| `tracing`            | Structured event macros (`info!`, `warn!`, etc.) |
| `tracing-subscriber` | Subscriber registry, formatting, env-filter      |
| `tracing-appender`   | Non-blocking daily-rotated file writer           |

## Subscriber Architecture

`logging::init_tracing()` sets a global subscriber with two layers:

1. **Stdout** -- compact format with ANSI colors, useful during `task tauri:dev`
2. **File** -- daily-rotated files via `tracing-appender::rolling::daily`

Both layers share a single `EnvFilter`.

## Log File Location

| Platform | Path                                         |
|----------|----------------------------------------------|
| macOS    | `~/Library/Logs/com.mt.desktop/`             |
| Linux    | `$XDG_DATA_HOME/com.mt.desktop/logs/`        |

Files are named `mt.log.YYYY-MM-DD`.

## Log Levels and `MT_LOG` Override

Default levels:

- **Release builds**: `info`
- **Debug builds**: `debug`

Override with the `MT_LOG` environment variable (uses `tracing-subscriber`
`EnvFilter` syntax):

```bash
# Show all debug output
MT_LOG=debug task tauri:dev

# Trace-level for the watcher module only
MT_LOG=mt_tauri::watcher=trace task tauri:dev

# Silence everything except errors
MT_LOG=error task tauri:dev
```

## Rotation and Retention

- **Rotation**: daily (new file each calendar day)
- **Retention**: 3 days. Files older than 3 days are deleted on startup
  in `cleanup_old_logs()`.

## Export Diagnostics

Settings > Export Logs produces a text file containing:

1. App version, build ID, platform
2. Rust version, working directory
3. Log directory path
4. Up to 3 most recent log files (newest first), capped at 5 MB total

## IPC Instrumentation

All 94 `#[tauri::command]` functions have `#[tracing::instrument]` annotations.
High-frequency polling commands (`audio_get_status`, `audio_get_volume`,
`queue_get_playback_state`) use `level = "trace"` to stay out of normal logs.

`logging::log_slow_command()` emits a `warn` when any command exceeds 500 ms.

## Frontend Error Capture

`error-reporter.js` installs two global handlers at startup:

- `window.addEventListener('error', ...)` -- uncaught exceptions
- `window.addEventListener('unhandledrejection', ...)` -- unhandled promise rejections

Both route to the `log_frontend_error` Tauri command, which logs at
`target: "mt::frontend"`. Use `reportError(level, message, context)` for
explicit error reporting from frontend code.

## Reading Structured Output

Each log line contains:

```text
2025-01-15T10:23:45.123Z  INFO mt_tauri::watcher: Folder scan complete folder_id=1 added=12 updated=3 deleted=0
```

- **Timestamp** -- UTC
- **Level** -- TRACE, DEBUG, INFO, WARN, ERROR
- **Target** -- Rust module path (e.g. `mt_tauri::watcher`)
- **Message** -- human-readable summary
- **Fields** -- structured key=value pairs from `tracing` macros
