# Signed Builds

Code signing, notarization, and distribution for mt across platforms.

## macOS

### Overview

mt is distributed as a direct download (not via the Mac App Store). This requires:

1. **Code signing** with a Developer ID Application certificate
2. **Notarization** via Apple's notary service (scans for malware, issues a trust ticket)
3. **Stapling** the notarization ticket to the app bundle

Without all three, macOS Gatekeeper blocks the app on users' machines.

### Prerequisites

- Apple Developer Program membership
- Developer ID Application certificate (created in Xcode or Apple Developer portal)
- App Store Connect API key (for notarization)

### Environment Variables

All signing secrets are stored in `.env` (loaded via Taskfile dotenv). See `.env.example` for the template.

| Variable | Purpose |
|----------|---------|
| `APPLE_SIGNING_IDENTITY` | Full signing identity string, e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` certificate export |
| `APPLE_CERTIFICATE_PASSWORD` | Password set during `.p12` export |
| `APPLE_API_KEY` | App Store Connect API key ID (10-char alphanumeric) |
| `APPLE_API_ISSUER` | App Store Connect API issuer UUID |
| `APPLE_API_KEY_B64` | Base64-encoded `.p8` private key content |
| `KEYCHAIN_PASSWORD` | CI-only: password for the temporary signing keychain |

### Entitlements

`crates/mt-tauri/Entitlements.plist` declares hardened runtime entitlements:

| Entitlement | Reason |
|-------------|--------|
| `com.apple.security.cs.allow-jit` | WebView/JS engine |
| `com.apple.security.cs.allow-unsigned-executable-memory` | WebView/JS engine |
| `com.apple.security.cs.allow-dyld-environment-variables` | Bundled dylibs (TagLib via Zig) |
| `com.apple.security.network.client` | Last.fm API calls |
| `com.apple.security.files.user-selected.read-write` | User-selected music directories |

The app is **not sandboxed** - a music player needs broad filesystem access for library scanning.

### Local Signed Build

```bash
# Ensure .env is populated with signing secrets
task tauri:build:signed
```

This will:
1. Decode the base64 API key to `/tmp/auth_key.p8`
2. Build the Tauri app for `aarch64-apple-darwin`
3. Sign with the Developer ID certificate
4. Submit to Apple's notary service and wait for approval
5. Staple the notarization ticket
6. Build the DMG installer

### Verification

```bash
# Verify code signature
codesign --verify --deep --strict \
  target/aarch64-apple-darwin/release/bundle/macos/mt.app

# Verify Gatekeeper acceptance (requires notarization)
spctl --assess --type execute --verbose \
  target/aarch64-apple-darwin/release/bundle/macos/mt.app

# Inspect applied entitlements
codesign -d --entitlements - \
  target/aarch64-apple-darwin/release/bundle/macos/mt.app
```

### Taskfile Tasks

| Task | Description |
|------|-------------|
| `task tauri:build:signed` | Build signed + notarized `.app` and `.dmg` |
| `task tauri:build:dmg` | Build signed + notarized `.dmg` only |

Both require `APPLE_SIGNING_IDENTITY` to be set (enforced via precondition).

### CI/CD (GitHub Actions)

The release pipeline (`.github/workflows/release.yml`) runs on:
- Version tags (`v*`)
- Manual `workflow_dispatch`

It uses a self-hosted `[macOS, ARM64]` runner and:
1. Imports the certificate into a temporary CI keychain
2. Decodes the `.p8` API key from `APPLE_API_KEY_B64` secret
3. Builds with `tauri-action` which handles signing + notarization
4. Creates a draft GitHub Release with the signed DMG
5. Cleans up the keychain and key file (runs in `always()` step)

### Certificate Management

**Creating a new certificate:**
1. Open Xcode > Settings > Accounts > Manage Certificates
2. Click `+` > Developer ID Application
3. Export as `.p12` from Keychain Access

**Encoding for `.env`:**
```bash
# Certificate (.p12 -> base64)
openssl base64 -A -in cert.p12 | pbcopy

# API key (.p8 -> base64)
openssl base64 -A -in AuthKey_XXXXXXXXXX.p8 | pbcopy
```

**Finding your signing identity:**
```bash
security find-identity -v -p codesigning
```

### Tauri Configuration

`crates/mt-tauri/tauri.conf.json` contains the bundle config:

```json
"macOS": {
  "minimumSystemVersion": "10.15",
  "entitlements": "./Entitlements.plist",
  "dmg": {
    "windowSize": { "width": 660, "height": 400 },
    "appPosition": { "x": 180, "y": 170 },
    "applicationFolderPosition": { "x": 480, "y": 170 }
  }
}
```

The signing identity is **not** hardcoded in config - Tauri reads `APPLE_SIGNING_IDENTITY` from the environment, so unsigned dev builds still work.

## Windows

> Not yet implemented. Placeholder for future Windows code signing with Authenticode / EV certificates.

### Planned Approach

- Sign with an EV code signing certificate (avoids SmartScreen warnings)
- Use `signtool.exe` or Tauri's built-in Windows signing support
- NSIS or WiX installer bundle
- GitHub Actions runner: `windows-latest` or self-hosted

## Linux

> Not yet implemented. Placeholder for future Linux packaging.

### Planned Approach

- AppImage and/or `.deb` / `.rpm` packages
- GPG signing for package repositories
- GitHub Actions runner: `ubuntu-latest`
