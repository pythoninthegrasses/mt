# Task Completion Checklist

When completing coding tasks in the mt project, ensure these steps are followed:

## Code Quality Checks

### Frontend (JavaScript/CSS)
1. **Linting**: Run `deno lint` (native Deno linter)
2. **Formatting**: Run `deno fmt` (native Deno formatter) or `task format`

### Backend (Rust)
1. **Linting**: Run `cargo clippy --workspace`
2. **Formatting**: Run `cargo fmt --all`
3. **Type Checking**: Run `cargo check --workspace` for fast validation

## Testing

### Run Tests
1. **All tests (Rust + Vitest)**: `task test`
2. **Vitest unit tests only**: `task npm:test`
3. **Playwright E2E (fast/webkit)**: `task test:e2e`
4. **Playwright E2E (all browsers)**: `E2E_MODE=full task test:e2e`

### Add Tests
- **Frontend store logic**: Write Vitest tests
- **Frontend UI/integration**: Write Playwright E2E tests
- **Rust backend**: Write `#[test]` unit tests in the relevant module

## Pre-commit Hooks
1. **Run Hooks**: Execute `pre-commit run --all-files` to run all configured hooks
2. **Address Issues**: Fix any issues identified by the hooks

## Manual Testing
1. **Application Launch**: Run `task tauri:dev` and verify the app starts without errors
2. **Feature Testing**: Test the specific functionality that was modified
3. **Cross-platform**: Primary target is macOS; Linux and Windows also supported

## Documentation
1. **Code Comments**: Add comments only when requested or for complex logic
2. **Update Docs**: Update relevant documentation if architecture changes

## Git Workflow
1. **Atomic Commits**: Each commit should be a single, complete, coherent unit of work
2. **Commit Changes**: Only commit when explicitly requested by user
3. **Clear Messages**: Use descriptive commit messages that explain the "why"
4. **No Sensitive Data**: Never commit secrets, keys, or sensitive information
5. **Squash Before Push**: Offer to squash related atomic commits via `git rebase -i`

## Environment Considerations
- Frontend uses Tauri WebView with Alpine.js + Basecoat (Tailwind CSS)
- Backend is pure Rust (audio via symphonia/rodio, database via rusqlite)
- Audio playback only works in Tauri runtime, not standalone browsers
- Test with both development (`task tauri:dev`) and production (`task build`) modes
- Use `task tauri:dev:mcp` when authoring/debugging E2E tests with MCP bridge