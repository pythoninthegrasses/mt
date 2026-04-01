---
id: TASK-307
title: >-
  Add structured JSONL logging, temperature control, and think toggle to
  scripts/agent.py
status: In Progress
assignee: []
created_date: '2026-04-01 22:05'
updated_date: '2026-04-01 22:06'
labels:
  - scripts
  - agent
  - logging
dependencies: []
references:
  - scripts/agent.py
  - crates/mt-tauri/src/agent/prompt.rs
  - crates/mt-tauri/src/agent/mod.rs
priority: high
ordinal: 1125
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Enhance the Python Ollama agent simulation script (`scripts/agent.py`) with three features:

1. **Structured JSONL logging** — Write structured JSON lines to `/tmp/ollama_python_agent.jsonl` (append mode) using stdlib `logging` with a custom `_JSONFormatter`. Log session start/end, each turn, tool calls/results, model responses, parse outcomes, and errors.

2. **Temperature control** — Default 0.45, configurable via `AGENT_TEMPERATURE` env var and `--temperature` CLI flag. Passed to `client.chat()` via `options={'temperature': ...}` dict.

3. **Think toggle** — Default off (`think=False`), configurable via `AGENT_THINK` env var and `--think` CLI flag. The API-level `think` param on `client.chat()` is the correct way to control this (not `/nothink` in the prompt). Display both temperature and think state in the session header stdout block.

## Background

- `scripts/agent.py` is a self-contained PEP 723 script (`uv run --script`) that simulates the Rust Genius agent's multi-turn tool-calling loop against a local Ollama instance + mt.db
- Uses `ollama` Python library (`Client`, `ChatResponse`), `python-decouple` for `.env` config
- The Rust agent reference is in `crates/mt-tauri/src/agent/` (mod.rs, prompt.rs, tools.rs, types.rs)
- Default model: `qwen3.5:9b` (configurable via `OLLAMA_MODEL`)
- 8 tools total: 3 local (get_recently_played, get_top_artists, search_library) + 5 Last.fm stubs
- The script already has `_JSONFormatter` and `_setup_logging()` defined but not yet wired up
- Tool result display already reformatted to show `artist - track` instead of raw JSON
- `DEFAULT_LOG_FILE` config var already exists pointing to `.jsonl` path

## Ollama Python API Reference

```python
from ollama import Options
response = client.chat(
    model=model,
    messages=messages,
    tools=TOOLS,
    options={'temperature': 0.45},
    think=False,  # True, False, or 'low'|'medium'|'high'
)
response.message.thinking  # reasoning text when think=True
response.message.content   # final answer
response.message.tool_calls  # tool call list
```

## Relevant Files

- `scripts/agent.py` — Primary file (all changes here)
- `crates/mt-tauri/src/agent/prompt.rs` — Rust reference for system prompt, defaults
- `.env` — Config file at repo root (resolved via python-decouple)

## Current Config Vars (decouple)

| Var | Default | Type |
|-----|---------|------|
| OLLAMA_MODEL | qwen3.5:9b | str |
| OLLAMA_HOST | http://localhost:11434 | str |
| AGENT_MAX_TURNS | 5 | int |
| AGENT_LOG_FILE | /tmp/ollama_python_agent.jsonl | str |

## New Config Vars to Add

| Var | Default | Type |
|-----|---------|------|
| AGENT_TEMPERATURE | 0.45 | float |
| AGENT_THINK | false | bool |

## Implementation Plan

### 1. Add env vars (AGENT_TEMPERATURE, AGENT_THINK)
After existing config vars (~line 55), add:
```python
DEFAULT_TEMPERATURE = config("AGENT_TEMPERATURE", default=0.45, cast=float)
DEFAULT_THINK = config("AGENT_THINK", default=False, cast=bool)
```

### 2. Update run_agent() signature
Add `temperature` and `log_file` parameters:
```python
def run_agent(prompt, *, model, host, max_turns, db_path, think, temperature, log_file)
```

### 3. Wire up _setup_logging()
Call at top of run_agent(), before any other work.

### 4. Add logging calls throughout run_agent()
Use `log.info("event_name", extra={"data": {...}})` pattern:
- session_start: model, prompt, max_turns, think, temperature, db_path, track_count
- turn_start: turn number
- tool_call: tool name, args
- tool_result: tool name, result count, result data
- tool_error: tool name, error message
- thinking: thinking text (truncated)
- final_response: full content
- parse_success: playlist name, track ids, valid count
- parse_failure: raw content
- session_end: reason (success/exhausted), total turns used

### 5. Pass temperature and think to client.chat()
```python
kwargs = {
    "model": model,
    "messages": messages,
    "tools": TOOLS,
    "options": {"temperature": temperature},
    "think": think,
}
```
Remove the conditional `if think: kwargs["think"] = True` block.

### 6. Update session header
```python
print(f"Model: {model} | Max turns: {max_turns} | Think: {think} | Temp: {temperature}")
```

### 7. Add CLI args
- `--temperature` (float, default from env)
- `--log-file` (str, default from env)

### 8. Update main() to pass new args to run_agent()
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 JSONL log file written to /tmp/ollama_python_agent.jsonl in append mode with one JSON object per line
- [ ] #2 Each log entry has ts, level, event, and optional data fields
- [ ] #3 Log covers: session_start, turn_start, tool_call, tool_result, tool_error, thinking, final_response, parse_success, parse_failure, session_end, session_exhausted
- [ ] #4 Temperature defaults to 0.45, configurable via AGENT_TEMPERATURE env var and --temperature CLI flag
- [ ] #5 Think defaults to False, configurable via AGENT_THINK env var and --think CLI flag
- [ ] #6 Temperature passed to client.chat() via options={'temperature': ...} dict
- [ ] #7 Think passed to client.chat() as think=True/False kwarg
- [ ] #8 Session header displays: Model, Max turns, Think, Temperature
- [ ] #9 --log-file CLI arg overrides AGENT_LOG_FILE default
- [ ] #10 _setup_logging() called at start of run_agent()
- [ ] #11 Tool results display as 'artist - track' format (not raw JSON) for track results
- [ ] #12 All existing print() console output preserved alongside new file logging
<!-- AC:END -->
