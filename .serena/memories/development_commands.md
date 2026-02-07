# Development Commands

## Essential Commands

### Running the Application
```bash
# Standard run (production)
uv run main.py

# Development with auto-reload
uv run repeater
# or
uv run python utils/repeater.py
```

### Package Management
```bash
# Install dependencies
uv sync --frozen

# Add new dependency
uv add package-name

# Add dev dependency  
uv add --dev package-name

# Update dependencies
uv lock --upgrade
```

### Code Quality
```bash
# Run linting
uv run ruff check --fix --respect-gitignore
# or
task lint

# Run formatting
uv run ruff format --respect-gitignore  
# or
task format

# Run tests
uv run pytest -v
# or
task test

# Run pre-commit hooks
pre-commit run --all-files
# or
task pre-commit

# Clean Python cache
task pyclean
```

### Build Commands
```bash
# Build Zig modules
uv run python build.py

# Clean build artifacts
rm -rf src/.zig-cache src/zig-out core/*.so
```

### Task Runner
```bash
# List all available tasks
task --list

# Run specific tasks
task lint
task format
task test
task uv:sync
task uv:lock
```

## Development Workflow
1. Use `uv run repeater` for development with auto-reload
2. Make changes to code
3. Test changes (auto-reload handles restart)
4. Run linting: `task lint` 
5. Run formatting: `task format`
6. Run tests: `task test`
7. Commit changes