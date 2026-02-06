# Serena Tool Tips for mt Project

## Running Tests from the Correct Directory
- **Playwright E2E tests** MUST be run from `app/frontend/`, NOT from the project root
  - Correct: `cd app/frontend && npx playwright test tests/sidebar.spec.js`
  - Also correct: `task test:e2e` (task runner handles the directory)
  - Wrong: `npx playwright test tests/sidebar.spec.js` (from project root — fails)
- **Vitest unit tests** also run from `app/frontend/`:
  - Correct: `npm --prefix app/frontend test` or `task npm:test`
- **Rust tests** run from project root:
  - Correct: `task test` or `cargo test --manifest-path src-tauri/Cargo.toml`

## Parameter Names
- `find_symbol` uses `name_path_pattern` (NOT `name_path`)
- `find_referencing_symbols` uses `name_path` (NOT `name_path_pattern`)

## JavaScript/Alpine.js Limitations
- Methods defined inside object literals (Alpine.js component pattern) are often NOT indexed by the LSP
- `find_symbol` may return `[]` for methods like `deleteSelectedPlaylists` or `handlePlaylistKeydown` in sidebar.js
- Use `search_for_pattern` with context lines to find these methods instead
- `get_symbols_overview` may only show the top-level factory function, not the methods within
- This applies to all components in `app/frontend/js/components/` since they use the Alpine.js `Alpine.data()` pattern with object literals
