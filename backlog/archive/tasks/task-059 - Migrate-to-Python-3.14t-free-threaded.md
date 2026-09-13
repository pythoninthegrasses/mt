---
id: task-059
title: Migrate to Python 3.14t (free-threaded)
status: To Do
assignee: []
created_date: '2025-10-21 06:58'
updated_date: '2026-01-10 07:15'
labels: []
dependencies: []
priority: high
ordinal: 14500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Incrementally upgrade Python from 3.11 to 3.14t (free-threaded), testing and fixing issues at each version step. This enables true parallelism by removing the Global Interpreter Lock (GIL).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Upgrade to Python 3.12 and ensure all tests pass
- [ ] #2 Upgrade to Python 3.13 and ensure all tests pass
- [ ] #3 Upgrade to Python 3.14 (standard) and ensure all tests pass
- [ ] #4 Upgrade to Python 3.14t (free-threaded) and ensure all tests pass
- [ ] #5 Verify all functionality works correctly with free-threaded Python
- [ ] #6 Update documentation to reflect Python 3.14t requirement
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Python 3.12 Upgrade Complete (2025-10-25)

### Summary
Successfully upgraded from Python 3.11.11 to 3.12.9. All 516 tests pass with 58% coverage maintained.

### Changes Made
- Updated `.tool-versions` to python 3.12.9
- Updated `pyproject.toml` to require python >=3.12,<3.13
- Pinned `ziggy-pydust==0.25.1` for Zig 0.14.0 compatibility (0.26.0 requires Zig 0.15.1)
- Rebuilt Zig extension modules successfully

### Regressions Fixed During Manual Testing
1. **Play/pause icon not updating**: Added explicit `update_play_button()` calls in `player_core.py`
2. **Queue not populating from media key**: Added queue population logic from library view
3. **Search not filtering**: Fixed `perform_search()` to directly populate queue view
4. **App startup failure**: Fixed initialization order for `queue_handler` reference

All fixes in: `core/controls/player_core.py`, `core/player/handlers.py`, `core/player/__init__.py`

### Testing Gap Analysis
Created follow-up tasks to address test coverage gaps discovered during migration:
- **task-074**: Add integration tests for recent bug fixes (high priority)
- **task-075**: Add unit tests for PlayerEventHandlers class (0% coverage)
- **task-356**: Increase PlayerCore coverage from 29% to 50%+

### Python 3.12 Compatibility Notes
- No deprecation warnings triggered
- Asyncio behavior stable (limited usage in project)
- VLC bindings working correctly
- All dependencies compatible

### Next Steps for task-059
- Proceed to AC #2: Upgrade to Python 3.13
- Monitor for Python 3.13 specific changes (PEP 701 f-strings, etc.)
- Continue validating Zig/ziggy-pydust compatibility at each step

## Tool Management

Continue using mise for uv management:
```bash
mise use uv
# This manages uv@0.8.8 in .tool-versions (NOT .python-version)
```

## Migration Strategy

1. **3.11 → 3.12**: Update version in mise/uv config, run tests, fix deprecations
2. **3.12 → 3.13**: Update version, test, address any new warnings
3. **3.13 → 3.14**: Update to standard 3.14, verify compatibility
4. **3.14 → 3.14t**: Switch to free-threaded, test for thread-safety issues

## Key Considerations

- **Thread Safety**: Free-threaded Python requires thread-safe code
- **Dependencies**: Verify all dependencies support 3.14t
- **Zig Modules**: Ensure pydust and Zig extensions work with 3.14t
- **VLC Bindings**: Test python-vlc with free-threaded interpreter
- **Performance**: Benchmark before/after for potential gains

## Testing Focus

- Unit tests (fast feedback loop)
- Property-based tests (invariant validation)
- E2E tests (integration validation)
- Manual UI testing with auto-reload
- Zig extension module functionality

## Reference

<https://astral.sh/blog/python-3.14#free-threaded-python>
<!-- SECTION:NOTES:END -->
