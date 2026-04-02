# Agent Performance Fixes (TASK-277)

## Issues
1. **Parallel tool execution not working** - Model not calling multiple tools per turn
2. **Token cap needed** - Response generation taking 63s due to excessive token generation

## Changes Required

### 1. Add max_tokens to agent builder (mod.rs)
Add `.max_tokens(1024)` after `.temperature(0.2)` in the `build_agent()` function.

### 2. Update system prompt (prompt.rs)
Add explicit instruction to call multiple tools in parallel. The prompt should say something like:
"You can and SHOULD call multiple tools in a single turn. Use parallel tool calls to gather information faster."

### 3. Run tests
- `cargo nextest run --workspace --features agent` should pass
