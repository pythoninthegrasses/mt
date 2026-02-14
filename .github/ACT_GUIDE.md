# Local GitHub Actions Testing with act

## Quick Reference

```bash
# Run lint checks (fastest, fully compatible)
act -W .github/workflows/test-local.yml -j lint

# List all available workflows and jobs
act -l

# Run specific workflow
act -W .github/workflows/test-local.yml
```

## Why test-local.yml?

The `test-local.yml` workflow is designed for act compatibility:

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
