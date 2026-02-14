# Local GitHub Actions Testing with act

## Quick Reference

```bash
# Run lint checks (fastest, Docker-based)
act -W .github/workflows/test-local.yml -j lint

# Run Playwright E2E tests (runs natively on your machine)
act -W .github/workflows/test-local.yml -j playwright

# Debug build issues (runs natively on your machine)
act -j build -W .github/workflows/test.yml 2>&1 | tee /tmp/act-build.log

# List all available workflows and jobs
act -l

# Run all local tests
act -W .github/workflows/test-local.yml
```

## Debugging with act

act is invaluable for debugging CI failures:

1. **Reproduce errors locally** - Run the exact same steps as CI
2. **Iterate quickly** - No need to push/wait for CI
3. **See full output** - All logs captured (even what's hidden in CI)
4. **Native execution** - Self-hosted runners run on your machine with all your tools

**Example**: We used act to find the cmake error in `build-taglib.sh`:
```bash
act -j build 2>&1 | tee /tmp/act-build.log
grep -i "cmake error" /tmp/act-build.log
# Found: CMake Error: The source directory "/tmp/taglib-2.0.2" does not appear to contain CMakeLists.txt.
```

## Why test-local.yml?

The `test-local.yml` workflow is designed **exclusively for local testing**:

- ✅ **Never runs in GitHub Actions** (uses `workflow_dispatch:` trigger)
- ✅ No node24 runtime issues (skips problematic GitHub Actions)
- ✅ Installs tools directly (Deno, etc.)
- ✅ Fast feedback loop
- ✅ Works in Docker containers

The main `test.yml` workflow uses newer GitHub Actions that require node24 runtime, which act doesn't support yet.

## Configuration

The `.actrc` file handles platform mappings:

```bash
# Self-hosted runners run natively (no Docker)
-P macOS=-self-hosted
-P ARM64=-self-hosted
-P studio=-self-hosted

# Ubuntu runs in Docker
-P ubuntu-latest=catthehacker/ubuntu:act-latest

# Match host architecture
--container-architecture=linux/arm64

# Reuse containers for speed
--reuse
```

## Common Issues

### Flaky Playwright Tests

The Playwright E2E tests in CI can be **flaky** - they sometimes fail in CI but pass locally. If you see accessibility test failures in CI:

1. **Run locally first** to verify they pass:
   ```bash
   cd app/frontend
   npx playwright test tests/accessibility.spec.js
   ```

2. **Run via act** for CI-like environment:
   ```bash
   act -W .github/workflows/test-local.yml -j playwright
   ```

3. **Known flaky tests**:
   - `can navigate to player controls via Tab`
   - `can navigate sidebar sections with Tab`

These tests pass consistently locally but occasionally fail in CI due to timing issues.

### Node24 Runtime Error

If you see: `The runs.using key in action.yml must be one of: [composite docker node12 node16 node20], got node24`

**Solution:** Use `test-local.yml` instead of `test.yml`

### Docker Authentication Errors

```bash
# Clear stale Docker credentials
rm ~/.docker/config.json
docker logout
```

### Self-Hosted Runner Warnings

Jobs with `runs-on: [macOS, ARM64]` or `runs-on: studio` will run on your machine natively. This is expected behavior defined in `.actrc`.

## Resources

- [act Documentation](https://nektosact.com)
- [act GitHub](https://github.com/nektos/act)
