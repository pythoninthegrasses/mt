# Last.fm Integration

Rust implementation of Last.fm API integration for mt desktop music player, providing OAuth 1.0a authentication, scrobbling, now playing updates, and loved tracks import.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Module Structure](#module-structure)
- [OAuth 1.0a Authentication Flow](#oauth-10a-authentication-flow)
- [Signature Generation](#signature-generation)
- [Rate Limiting](#rate-limiting)
- [Scrobbling Logic](#scrobbling-logic)
- [Database Schema](#database-schema)
- [Tauri Commands](#tauri-commands)
- [Frontend Integration](#frontend-integration)
- [Error Handling](#error-handling)
- [Testing](#testing)
- [Security Considerations](#security-considerations)

## Architecture Overview

The Last.fm integration is implemented as a modular Rust backend with the following components:

```text
crates/mt-tauri/src/
├── lastfm/
│   ├── mod.rs              # Module exports
│   ├── client.rs           # HTTP client with reqwest
│   ├── config.rs           # API key configuration
│   ├── signature.rs        # MD5 signature generation
│   ├── signature_ffi.rs    # FFI wrapper for Zig signature generation
│   ├── rate_limiter.rs     # Request rate limiting
│   └── types.rs            # Request/response types
└── commands/
    └── lastfm.rs           # Tauri commands exposed to frontend
```

**Key Design Decisions:**

- **Async/await**: All API calls use `tokio` async runtime
- **Rate limiting**: Enforced at client level (5/sec, 333/day)
- **Error handling**: Custom error types with `thiserror`
- **Type safety**: Strong typing with `serde` serialization
- **Event system**: Tauri events for real-time frontend updates

## Module Structure

### `lastfm/client.rs` - HTTP Client

The `LastFmClient` provides the core HTTP interface to Last.fm API:

```rust
pub struct LastFmClient {
    config: ApiKeyConfig,
    rate_limiter: Arc<RateLimiter>,
    http_client: reqwest::Client,
    base_url: String,
}
```

**Key Methods:**

- `api_call()` - Generic authenticated API call with signature generation
- `get_auth_url()` - Get OAuth token and authorization URL
- `get_session()` - Exchange token for session key
- `get_loved_tracks()` - Fetch loved tracks (paginated)
- `update_now_playing()` - Update "Now Playing" status
- `scrobble()` - Submit a scrobble

### `lastfm/config.rs` - API Key Management

Handles API key configuration with environment-based loading:

```rust
pub struct ApiKeyConfig {
    pub api_key: Option<String>,
    pub api_secret: Option<String>,
}
```

**Development builds**: Reads from `LASTFM_API_KEY` and `LASTFM_API_SECRET` env vars

**Release builds**: TODO - Currently uses env vars, future implementation will use HMAC-SHA256 obfuscation to embed keys in binary

### `lastfm/signature.rs` - OAuth Signature

Implements Last.fm's MD5 signature generation:

```rust
pub fn sign_params(params: &BTreeMap<String, String>, api_secret: &str) -> String
```

**Signature Algorithm:**

1. Sort all parameters alphabetically by key (excluding `format`)
2. Concatenate as `"key1value1key2value2..."`
3. Append API secret
4. Compute MD5 hash
5. Convert to lowercase hex string

### `lastfm/rate_limiter.rs` - Request Throttling

Enforces Last.fm API rate limits using tokio::sync::Mutex:

```rust
pub struct RateLimiter {
    requests: Mutex<Vec<u64>>,
    daily_limit: usize,        // 333 requests/day
    per_second_limit: usize,   // 5 requests/second
}
```

**Behavior:**

- Tracks timestamps of all requests in rolling 24-hour window
- Blocks async execution if limits exceeded
- Automatically cleans up expired timestamps

### `lastfm/types.rs` - Type Definitions

Comprehensive type definitions for all API requests/responses using serde:

- Settings types: `LastfmSettings`, `LastfmSettingsUpdate`
- Auth types: `AuthUrlResponse`, `AuthCallbackResponse`, `SessionInfo`
- Scrobbling types: `ScrobbleRequest`, `NowPlayingRequest`, `ScrobbleResponse`
- Queue types: `QueueStatusResponse`, `QueueRetryResponse`
- Import types: `ImportLovedTracksResponse`, `LovedTracksResponse`

### `commands/lastfm.rs` - Tauri Commands

Exposes 13 Tauri commands to frontend:

**Settings:**

- `lastfm_get_settings()` - Get current settings
- `lastfm_update_settings()` - Update enabled/threshold

**Authentication:**

- `lastfm_get_auth_url()` - Get OAuth URL
- `lastfm_auth_callback()` - Complete OAuth
- `lastfm_disconnect()` - Disconnect account

**Scrobbling:**

- `lastfm_now_playing()` - Update now playing
- `lastfm_scrobble()` - Scrobble track

**Queue:**

- `lastfm_queue_status()` - Get queue count
- `lastfm_queue_retry()` - Retry failed scrobbles

**Import:**

- `lastfm_import_loved_tracks()` - Import loved tracks
- `lastfm_cache_loved_tracks()` - Cache loved tracks from Last.fm
- `lastfm_match_loved_tracks()` - Match cached loved tracks to library
- `lastfm_loved_stats()` - Get loved tracks import statistics

## OAuth 1.0a Authentication Flow

Last.fm uses OAuth 1.0a with MD5 signatures. The flow involves three steps:

### Step 1: Get Authorization URL

```rust
#[tauri::command]
pub async fn lastfm_get_auth_url(app: AppHandle) -> Result<AuthUrlResponse, String>
```

1. Call `auth.getToken` API method to get request token
2. Construct authorization URL: `https://www.last.fm/api/auth/?api_key=XXX&token=YYY`
3. Emit `lastfm:auth` event with status `"pending"`
4. Return URL and token to frontend

**Frontend Action:** Open authorization URL in browser

### Step 2: User Authorization

User visits authorization URL, logs into Last.fm, and authorizes the mt application. Last.fm then redirects to callback URL (which we ignore in desktop app).

### Step 3: Exchange Token for Session

```rust
#[tauri::command]
pub async fn lastfm_auth_callback(
    app: AppHandle,
    db: State<'_, Database>,
    token: String,
) -> Result<AuthCallbackResponse, String>
```

1. Call `auth.getSession` with token and signature
2. Receive session key and username
3. Store in database:
   - `lastfm_session_key` → session key (plaintext)
   - `lastfm_username` → username
   - `lastfm_scrobbling_enabled` → `true`
4. Emit `lastfm:auth` event with status `"authenticated"`

**Security Note:** Session keys are stored **plaintext** in local database because:

- Database is on user's local machine
- Session key must be reversible to make API calls
- If attacker has database access, they already own the machine
- This is standard practice for OAuth session tokens

## Signature Generation

Last.fm requires MD5 signatures for all authenticated requests (write operations and session establishment).

### Algorithm

```rust
fn sign_params(params: &BTreeMap<String, String>, api_secret: &str) -> String {
    // 1. Concatenate sorted params (excluding 'format')
    let mut signature_string = String::new();
    for (key, value) in params.iter() {
        if key != "format" {
            signature_string.push_str(key);
            signature_string.push_str(value);
        }
    }

    // 2. Append API secret
    signature_string.push_str(api_secret);

    // 3. MD5 hash and hex encode
    format!("{:x}", md5::compute(signature_string.as_bytes()))
}
```

### Example

Request parameters:
```text
api_key: "abc123"
method: "track.scrobble"
artist: "Test Artist"
track: "Test Track"
timestamp: "1234567890"
sk: "session_key_123"
```

Signature string (sorted, format excluded):
```text
api_keyabc123artistTest Artistmethodtrack.scrobbleskSession_key_123timestampTest Track1234567890test_secret
```

MD5 hash: `c28d80ed34429217b843d790ea55d9ca`

## Rate Limiting

Last.fm enforces strict API limits:

- **5 requests per second**
- **333 requests per 24 hours** (rolling window)

### Implementation

```rust
pub async fn wait_if_needed(&self) {
    let mut requests = self.requests.lock().await;
    let now = Self::current_timestamp();

    // Clean old requests (> 24 hours)
    requests.retain(|&req_time| now - req_time < 86400);

    // Check daily limit
    if requests.len() >= self.daily_limit {
        let oldest = requests[0];
        let wait_time = 86400 - (now - oldest);
        sleep(Duration::from_secs(wait_time)).await;
    }

    // Check per-second limit
    let recent = requests.iter()
        .filter(|&&t| now - t < 1)
        .count();

    if recent >= self.per_second_limit {
        sleep(Duration::from_secs(1)).await;
    }

    // Record this request
    requests.push(now);
}
```

The rate limiter is shared via `Arc<RateLimiter>` across all API calls, ensuring global enforcement.

## Scrobbling Logic

### Threshold-Based Scrobbling

Last.fm requires scrobbles meet specific criteria. Our implementation uses a configurable threshold (25-100%, default 90%).

```rust
fn should_scrobble(duration: f64, played_time: f64, threshold_percent: u8) -> bool {
    if duration <= 0.0 {
        return false;
    }

    let threshold_fraction = threshold_percent as f64 / 100.0;
    let fraction_played = played_time / duration;
    let threshold_time = duration * threshold_fraction;

    // ALL three conditions must be met:
    let meets_minimum = played_time >= 30.0;               // Absolute minimum
    let meets_fraction = fraction_played >= threshold_fraction;  // Percentage
    let meets_threshold_or_cap = played_time >= f64::min(threshold_time, 240.0);  // Cap at 4 minutes

    meets_minimum && meets_fraction && meets_threshold_or_cap
}
```

**Rules:**

1. **Absolute minimum**: Must play at least 30 seconds
2. **Percentage requirement**: Must play >= threshold percentage of track
3. **Max cap**: For long tracks, capped at 240 seconds (4 minutes) OR threshold percentage, whichever is reached first

**Examples:**

| Track Length | Threshold | Required Play Time | Reasoning |
|--------------|-----------|-------------------|-----------|
| 200s (3:20) | 50% | 100s (50%) | Half of track |
| 60s (1:00) | 90% | 54s (90%) | 90% of track |
| 600s (10:00) | 50% | 300s (50%) | Half of track (cap doesn't apply) |
| 1200s (20:00) | 50% | 600s (50%) | Half of track (exceeds 240s cap but still needs 50%) |
| 20s (0:20) | 90% | Cannot scrobble | Less than 30s minimum |

### Now Playing Updates

"Now Playing" updates are **non-critical** and fail silently:

```rust
#[tauri::command]
pub async fn lastfm_now_playing(
    db: State<'_, Database>,
    request: NowPlayingRequest,
) -> Result<serde_json::Value, String> {
    // ... authentication checks ...

    match client.update_now_playing(...).await {
        Ok(_) => Ok(json!({ "status": "success" })),
        Err(e) => {
            // Non-critical - just log and return error status
            eprintln!("[lastfm] Now Playing update failed: {}", e);
            Ok(json!({ "status": "error", "message": e.to_string() }))
        }
    }
}
```

### Scrobble Submission

Scrobbles are **critical** and queue on failure:

```rust
#[tauri::command]
pub async fn lastfm_scrobble(
    app: AppHandle,
    db: State<'_, Database>,
    request: ScrobbleRequest,
) -> Result<ScrobbleResponse, String> {
    // ... threshold check ...

    match client.scrobble(...).await {
        Ok(accepted) if accepted > 0 => {
            // Success - emit event
            app.emit(ScrobbleStatusEvent::success(...));
            Ok(ScrobbleResponse { status: "success", message: None })
        }
        Ok(_) | Err(_) => {
            // Failed or not accepted - queue for retry
            queue_scrobble_for_retry(&app, &db, &request)?;
            app.emit(ScrobbleStatusEvent::queued(...));
            Ok(ScrobbleResponse {
                status: "queued",
                message: Some("Scrobble queued for retry")
            })
        }
    }
}
```

### Offline Queue & Retry Logic

Failed scrobbles are queued in the database and can be retried manually:

```rust
#[tauri::command]
pub async fn lastfm_queue_retry(
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<QueueRetryResponse, String> {
    // Get up to 100 queued scrobbles
    let queued = db.with_conn(|conn|
        scrobble::get_queued_scrobbles(conn, 100)
    )?;

    for queued_scrobble in queued {
        match client.scrobble(...).await {
            Ok(accepted) if accepted > 0 => {
                // Success - remove from queue
                scrobble::remove_queued_scrobble(conn, id)?;
                app.emit(ScrobbleStatusEvent::success(...));
            }
            _ => {
                // Failed - increment retry count
                scrobble::increment_scrobble_retry(conn, id)?;
            }
        }
    }

    // Emit queue updated event
    app.emit(LastfmQueueUpdatedEvent::new(remaining_count));
}
```

**Future Work:** Implement automatic background retry task (every 5 minutes when authenticated).

## Database Schema

### Settings Table

Last.fm settings stored as key-value pairs in `settings` table:

| Key | Type | Description |
|-----|------|-------------|
| `lastfm_session_key` | string | Session key from OAuth (plaintext) |
| `lastfm_username` | string | Last.fm username |
| `lastfm_scrobbling_enabled` | bool | Enable/disable scrobbling (1/0) |
| `lastfm_scrobble_threshold` | u8 | Scrobble threshold percentage (25-100) |

### Scrobble Queue Table

Failed scrobbles queued for retry in `scrobble_queue` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Queue entry ID |
| `artist` | TEXT | Artist name |
| `track` | TEXT | Track title |
| `album` | TEXT | Album name (optional) |
| `timestamp` | INTEGER | Unix timestamp |
| `retry_count` | INTEGER | Number of retry attempts |
| `created_at` | TIMESTAMP | When queued |

### Library Table

Favorites tracking in `library` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Track ID |
| `is_favorite` | BOOLEAN | Favorite flag |

## Tauri Commands

All commands are registered in `crates/mt-tauri/src/lib.rs`:

```rust
.invoke_handler(tauri::generate_handler![
    // ... other commands ...
    lastfm_get_settings,
    lastfm_update_settings,
    lastfm_get_auth_url,
    lastfm_auth_callback,
    lastfm_disconnect,
    lastfm_now_playing,
    lastfm_scrobble,
    lastfm_queue_status,
    lastfm_queue_retry,
    lastfm_import_loved_tracks,
    lastfm_cache_loved_tracks,
    lastfm_match_loved_tracks,
    lastfm_loved_stats,
])
```

### Command Reference

#### Settings Commands

**`lastfm_get_settings()`**

Get current Last.fm settings.

```typescript
const settings = await invoke('lastfm_get_settings');
// Returns: {
//   enabled: boolean,
//   username: string | null,
//   authenticated: boolean,
//   configured: boolean,
//   scrobble_threshold: number
// }
```

**`lastfm_update_settings(settingsUpdate)`**

Update scrobbling enabled flag and/or threshold.

```typescript
await invoke('lastfm_update_settings', {
  settingsUpdate: {
    enabled: true,
    scrobble_threshold: 90
  }
});
// Returns: { updated: ["enabled", "scrobble_threshold"] }
```

#### Authentication Commands

**`lastfm_get_auth_url()`**

Get Last.fm authorization URL and token.

```typescript
const { auth_url, token } = await invoke('lastfm_get_auth_url');
// Open auth_url in browser
// Store token for callback
```

**`lastfm_auth_callback(token)`**

Complete OAuth authentication.

```typescript
const result = await invoke('lastfm_auth_callback', { token });
// Returns: { status: "success", username: "johndoe", message: "..." }
```

**`lastfm_disconnect()`**

Disconnect Last.fm account.

```typescript
await invoke('lastfm_disconnect');
// Returns: { status: "success", message: "Disconnected from Last.fm" }
```

#### Scrobbling Commands

**`lastfm_now_playing(request)`**

Update "Now Playing" status (non-critical).

```typescript
await invoke('lastfm_now_playing', {
  request: {
    artist: "Artist Name",
    track: "Track Title",
    album: "Album Name",
    duration: 180
  }
});
// Returns: { status: "success" } or { status: "error", message: "..." }
```

**`lastfm_scrobble(request)`**

Scrobble a track.

```typescript
const result = await invoke('lastfm_scrobble', {
  request: {
    artist: "Artist Name",
    track: "Track Title",
    album: "Album Name",
    timestamp: Math.floor(Date.now() / 1000),
    duration: 180,
    played_time: 162  // 90% of 180s
  }
});
// Returns:
//   { status: "success" } - scrobbled successfully
//   { status: "queued", message: "..." } - queued for retry
//   { status: "threshold_not_met" } - didn't play enough
//   { status: "disabled" } - scrobbling disabled
```

#### Queue Commands

**`lastfm_queue_status()`**

Get number of queued scrobbles.

```typescript
const { queued_scrobbles } = await invoke('lastfm_queue_status');
// Returns: { queued_scrobbles: 5 }
```

**`lastfm_queue_retry()`**

Manually retry queued scrobbles.

```typescript
const result = await invoke('lastfm_queue_retry');
// Returns: {
//   status: "Successfully retried 3 scrobbles",
//   remaining_queued: 2
// }
```

#### Import Commands

**`lastfm_import_loved_tracks()`**

Import loved tracks from Last.fm and add to favorites.

```typescript
const result = await invoke('lastfm_import_loved_tracks');
// Returns: {
//   status: "success",
//   total_loved_tracks: 150,
//   imported_count: 120,
//   message: "Imported 120 tracks, 10 already favorited, 20 not in library"
// }
```

## Frontend Integration

Frontend JavaScript API client (`app/frontend/js/api.js`) provides hybrid Tauri/HTTP support:

```javascript
const invoke = window.__TAURI__?.core?.invoke;

export const api = {
  lastfm: {
    async getSettings() {
      if (invoke) {
        // Tauri mode - use commands
        return await invoke('lastfm_get_settings');
      }
      // Browser mode - use HTTP (fallback)
      return request('/lastfm/settings');
    },

    async scrobble(scrobbleData) {
      if (invoke) {
        return await invoke('lastfm_scrobble', { request: scrobbleData });
      }
      return request('/lastfm/scrobble', {
        method: 'POST',
        body: JSON.stringify(scrobbleData),
      });
    },

    // ... other methods ...
  }
};
```

### Event Listening

Frontend can listen for Tauri events:

```javascript
import { listen } from '@tauri-apps/api/event';

// Listen for auth events
listen('lastfm:auth', (event) => {
  console.log('Auth event:', event.payload);
  // payload: { status: "authenticated", username: "johndoe" }
  // payload: { status: "pending" }
  // payload: { status: "disconnected" }
});

// Listen for scrobble status
listen('lastfm:scrobble-status', (event) => {
  console.log('Scrobble:', event.payload);
  // payload: { status: "success", artist: "...", track: "..." }
  // payload: { status: "queued", artist: "...", track: "..." }
});

// Listen for queue updates
listen('lastfm:queue-updated', (event) => {
  console.log('Queue size:', event.payload.queued_scrobbles);
});
```

## Error Handling

### Error Types

```rust
#[derive(Debug, thiserror::Error)]
pub enum LastFmError {
    #[error("Last.fm API not configured (missing API key or secret)")]
    NotConfigured,

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Failed to parse response: {0}")]
    ParseError(String),

    #[error("Authentication failed")]
    AuthenticationFailed,

    #[error("Invalid or expired session")]
    InvalidSession,

    #[error("Last.fm service is offline")]
    ServiceOffline,

    #[error("Account suspended")]
    Suspended,

    #[error("Rate limit exceeded")]
    RateLimitExceeded,

    #[error("Last.fm API error {0}: {1}")]
    ApiError(u32, String),

    #[error("HTTP error {0}: {1}")]
    HttpError(u16, String),
}
```

### Error Code Mapping

Last.fm API error codes are mapped to specific error types:

| Code | Error Type | Description |
|------|------------|-------------|
| 4 | `AuthenticationFailed` | Invalid authentication token |
| 9 | `InvalidSession` | Session expired or invalid |
| 11 | `ServiceOffline` | Last.fm temporarily offline |
| 26 | `Suspended` | Account suspended |
| 29 | `RateLimitExceeded` | Rate limit hit |
| Other | `ApiError(code, msg)` | Generic API error |

### Frontend Error Display

Frontend shows user-friendly error messages:

```javascript
try {
  await api.lastfm.connectLastfm();
} catch (error) {
  const errorMsg = error.message || error.toString();
  Alpine.store('ui').toast(
    errorMsg.includes('API keys not configured')
      ? 'Last.fm API keys not configured. Set LASTFM_API_KEY and LASTFM_API_SECRET in .env file.'
      : `Failed to connect: ${errorMsg}`,
    'error'
  );
}
```

## Testing

### Unit Tests

Comprehensive unit tests cover all modules:

**Signature tests** (`lastfm/signature.rs`):

- Basic signature generation
- Format parameter exclusion
- Sorted parameter order
- Session key handling

**Rate limiter tests** (`lastfm/rate_limiter.rs`):

- Allows initial requests
- Enforces per-second limit
- Cleans expired requests

**Config tests** (`lastfm/config.rs`):

- Missing keys handling
- Partial config detection
- Full config validation

**Command helper tests** (`commands/lastfm.rs`):

- `is_setting_truthy()` - Boolean parsing
- `parse_threshold()` - Range clamping (25-100)
- `should_scrobble()` - Threshold logic (minimum time, percentage, max cap)

### Running Tests

```bash
# Run all tests
cargo test

# Run Last.fm tests only
cargo test lastfm

# Run with output
cargo test -- --nocapture

# Run specific test
cargo test test_should_scrobble_basic
```

### Test Coverage

- **13+ unit tests** across all modules
- **Signature verification** against Python reference implementation
- **Threshold logic** extensively tested with edge cases
- **Rate limiter** tested with async timing
- **Config parsing** tested for all valid/invalid inputs

## Security Considerations

### API Key Storage

**Current (Development):**

- API keys stored in `.env` file
- Read from environment variables at runtime
- ⚠️ Keys visible in memory and process environment

**Future (Release Builds):**

- Keys embedded in binary with HMAC-SHA256 obfuscation
- Salted hash verification at runtime
- Not true security (decompilation possible) but adds barrier
- Standard practice for desktop apps (Spotify, Discord, etc.)

### Session Key Storage

**Database Storage (Plaintext):**

- Session keys stored **unencrypted** in local SQLite database
- ✅ This is correct and secure because:
  - Database is on user's local machine only
  - Session key must be reversible for API calls
  - Hashing would make key unusable
  - If attacker has database access, machine is already compromised
- Standard practice for OAuth session tokens

### Network Security

**HTTPS Only:**

- All API calls use HTTPS (`https://ws.audioscrobbler.com/2.0/`)
- No HTTP fallback
- Certificates verified by reqwest

**Signature Security:**

- MD5 signatures prevent request tampering
- API secret never transmitted over network
- Each request signed individually

### Rate Limiting

**Protection Against:**

- Accidental abuse (runaway scripts)
- API key revocation due to excessive requests
- Service degradation

**Implementation:**

- Client-side rate limiting enforced before requests
- Server-side limits still apply (defense in depth)

## Migration Status

### Completed Features

✅ OAuth 1.0a authentication flow
✅ Settings management
✅ Scrobbling with threshold logic
✅ Now playing updates
✅ Offline queue with manual retry
✅ Loved tracks import (paginated)
✅ Rate limiting
✅ Error handling
✅ Frontend integration
✅ Tauri event system

### Pending Work

⏳ **Background Retry Task**: Automatic retry of queued scrobbles every 5 minutes when authenticated

⏳ **API Key Obfuscation**: HMAC-SHA256 salted hash for release builds

⏳ **E2E Tests**: Playwright tests for full authentication and scrobbling flows

## References

- [Last.fm API Documentation](https://www.last.fm/api)
- [Last.fm Authentication](https://www.last.fm/api/authentication)
- [Last.fm Scrobbling](https://www.last.fm/api/scrobbling)
- [OAuth 1.0a Specification](https://oauth.net/core/1.0a/)
- [MD5 Hash Algorithm](https://en.wikipedia.org/wiki/MD5)
