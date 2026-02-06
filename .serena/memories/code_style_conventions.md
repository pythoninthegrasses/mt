# Code Style and Conventions

## Frontend (JavaScript)

### Tooling
- **Linting**: `deno lint` (native Deno linter)
- **Formatting**: `deno fmt` (native Deno formatter)

### Style
- Alpine.js for reactive state management via stores and components
- Basecoat (Tailwind CSS) for utility-first styling
- Use `data-testid` attributes for stable Playwright selectors
- Use async/await for all Tauri command invocations

### File Organization
- Stores in `app/frontend/js/stores/` (queue, player, library, settings)
- Components in `app/frontend/js/components/` (sidebar, library-browser, etc.)
- API layer in `app/frontend/js/api.js`
- Event subscriptions in `app/frontend/js/events.js`
- Views/templates in `app/frontend/views/`
- 500 LOC limit per file when practical

### Patterns
- **Reactive State**: Alpine.js stores for global state (`Alpine.store()`)
- **Event-Driven**: Custom DOM events (`mt:playlists-updated`) for cross-component sync
- **Component-Based**: Modular Alpine.js components with `x-data`

## Backend (Rust)

### Tooling
- **Linting**: `cargo clippy --workspace`
- **Formatting**: `cargo fmt --all`
- **Fast Validation**: `cargo check --workspace` (2-3x faster than build)
- **Testing**: `cargo nextest run --workspace` (preferred) or `cargo test --workspace`

### Style
- Follow standard Rust conventions (snake_case functions, PascalCase types, UPPER_SNAKE_CASE constants)
- Use `#[tauri::command]` for all frontend-callable functions
- Serde for serialization/deserialization of IPC messages
- Async operations via Tokio runtime
- Structured error handling with Result types

### File Organization
- `src-tauri/src/audio/` — Audio engine (symphonia, rodio)
- `src-tauri/src/commands/` — Tauri command handlers
- `src-tauri/src/db/` — Database operations (rusqlite, migrations)
- `src-tauri/src/lastfm/` — Last.fm scrobbling integration
- `src-tauri/src/scanner/` — Library scanning and metadata extraction
- `src-tauri/src/watcher/` — File system monitoring

### Patterns
- **Command Pattern**: Tauri commands encapsulate backend operations
- **Repository Pattern**: Database layer abstracts data access
- **Event Emitters**: Backend pushes real-time updates to frontend via Tauri events

## Testing Conventions
- **Vitest**: Frontend store logic (unit/property tests)
- **Playwright**: All E2E and integration tests (desktop viewport 1624x1057)
- **Rust #[test]**: Backend unit and integration tests
- API mocking via Playwright fixtures (`mock-library.js`, `mock-playlists.js`)

## CSS
- Tailwind CSS utility classes via Basecoat design system
- No custom CSS unless strictly necessary
- Responsive design adapts to window sizes