---
id: TASK-021
title: Implement code signing
status: In Progress
assignee: []
created_date: '2025-09-17 04:11'
updated_date: '2026-02-07 00:46'
labels:
  - signing
  - macos
  - ci-cd
  - distribution
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Set up code signing for application packages and releases
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Research code signing requirements for macOS (done - Tauri v2 docs reviewed)
- [x] #2 Set up macOS code signing certificate (Developer ID Application)
- [x] #3 Create Entitlements.plist with hardened runtime and app-specific entitlements
- [x] #4 Configure tauri.conf.json with signingIdentity, entitlements, and DMG settings
- [x] #5 Set up notarization via App Store Connect API key

- [ ] #6 Configure GitHub secrets for certificate and notarization
- [ ] #7 Create release.yml GitHub Actions workflow with macOS ARM64 + x64 builds
- [ ] #8 Add Taskfile tasks for local signed builds
- [ ] #9 Test signed + notarized DMG on macOS
- [ ] #10 Set up Windows code signing certificates (future phase)
- [ ] #11 Configure automated code signing in CI/CD for Windows (future phase)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## macOS Code Signing & CI/CD Implementation Plan

### Phase 1: Certificate & Identity Setup (Local)

1. **Check for existing Fastlane certificate**
   - Look for existing "Developer ID Application" cert in Keychain Access on other Mac
   - If found, export as `.p12` with password
   - If not found, create new cert via Apple Developer portal:
     - Generate CSR from Mac
     - Create "Developer ID Application" certificate (requires Account Holder role)
     - Download and install `.cer` to keychain

2. **Verify signing identity locally**
   ```bash
   security find-identity -v -p codesigning
   ```

### Phase 2: Tauri Configuration

3. **Create `crates/mt-tauri/Entitlements.plist`**
   - Hardened runtime (enabled by default in Tauri v2)
   - Audio input/output entitlements (music player)
   - Network client entitlement (Last.fm scrobbling)
   - File read access (music library scanning)

4. **Update `crates/mt-tauri/tauri.conf.json`**
   - Add `bundle.macOS.signingIdentity` (use env var `APPLE_SIGNING_IDENTITY`)
   - Add `bundle.macOS.entitlements` pointing to Entitlements.plist
   - Configure DMG appearance (background, icon positions)
   - Keep `minimumSystemVersion: "10.15"`

### Phase 3: Notarization Setup

5. **Set up App Store Connect API Key (recommended method)**
   - Create API key in App Store Connect > Users and Access > Integrations
   - Download private key (one-time download)
   - Note Issuer ID and Key ID
   - Env vars: `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`

### Phase 4: CI/CD Pipeline

6. **Add GitHub secrets**
   - `APPLE_CERTIFICATE` - base64 encoded .p12
   - `APPLE_CERTIFICATE_PASSWORD` - .p12 export password
   - `APPLE_SIGNING_IDENTITY` - certificate identity string
   - `APPLE_API_ISSUER` - App Store Connect issuer ID
   - `APPLE_API_KEY` - API key ID
   - `APPLE_API_KEY_PATH` - private key (stored as secret, written to file in CI)
   - `KEYCHAIN_PASSWORD` - CI keychain password

7. **Create `.github/workflows/release.yml`**
   - Trigger: push to `release` branch or version tags (`app-v*`)
   - macOS ARM64 + x64 builds using `tauri-action`
   - Certificate import to CI keychain
   - Notarization via App Store Connect API
   - Draft GitHub Release with DMG artifacts
   - Rust + Node.js caching

### Phase 5: Local Build & Verify

8. **Add Taskfile signing tasks** (`taskfiles/tauri.yml`)
   - `task tauri:build:signed` - build with signing
   - `task tauri:build:dmg` - build signed DMG

9. **Test signed build locally**
   - Build signed .app and .dmg
   - Verify with `codesign --verify --deep --strict`
   - Verify notarization with `spctl --assess --type execute`
   - Test on clean macOS install (or different user account)

### Environment Variables Summary

| Variable | Local | CI | Purpose |
|----------|-------|----|---------|
| `APPLE_SIGNING_IDENTITY` | optional (use config) | required | Certificate identity |
| `APPLE_CERTIFICATE` | - | required | Base64 .p12 |
| `APPLE_CERTIFICATE_PASSWORD` | - | required | .p12 password |
| `APPLE_API_ISSUER` | optional | required | Notarization |
| `APPLE_API_KEY` | optional | required | Notarization |
| `APPLE_API_KEY_PATH` | optional | required | Notarization |
| `KEYCHAIN_PASSWORD` | - | required | CI keychain |
<!-- SECTION:PLAN:END -->
