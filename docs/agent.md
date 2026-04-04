# Agent Script — Playlist Generator

`scripts/agent.py` is a self-contained PEP 723 script that simulates the
Rust Genius agent's multi-turn tool-calling loop against a local Ollama
instance and the mt.db SQLite database. It serves as a rapid prototyping
environment for prompt engineering and tool design before changes are ported
to the Rust backend (`crates/mt-tauri/src/agent/`).

## Architecture

```text
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Ollama LLM  │◄───►│  agent.py    │◄───►│  mt.db       │
│  (qwen3.5)   │     │  tool loop   │     │  (SQLite)    │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────▼───────┐
                     │  Last.fm API │
                     │  (httpx GET) │
                     └──────────────┘
```

**Components:**

- **System prompt** — `_build_system_prompt(min_tracks, max_tracks)` generates a dynamic
  prompt with strategy routing (mood, artist, regional, mixed), artist variety rules,
  and interpolated track count bounds.
- **8 tools** — 3 local (SQLite) + 5 Last.fm (httpx → cross-ref with library).
  All tools return actionable hints on empty results to guide the model's
  next action.
- **Artist variety priority** — System prompt enforces 1 track per artist by default;
  only adds 2nd tracks when unique artists are exhausted.
- **Shuffled output** — `_shuffle_spread_artists()` uses greedy algorithm to spread
  same-artist tracks apart in the final playlist order.
- **JSONL logging** — Every session, turn, tool call, result, and parse
  outcome is logged to a structured JSONL file for analysis.
- **Hard cap** — `parse_response()` deduplicates and truncates track IDs to
  `MAX_PLAYLIST_TRACKS` regardless of model output.
- **Last-turn nudge** — On the final turn, a user message is injected telling
  the model to output the playlist immediately. Prevents turn exhaustion when
  `repeat_penalty` discourages the model from reusing its "compile now" pattern.
- **Creative naming** — System prompt instructs the model to use evocative
  synonyms for playlist names instead of parroting the user's request
  (e.g. "chill" -> "Velvet Haze").

## Usage

```bash
# Single prompt
uv run scripts/agent.py "make me a chill playlist"

# With options
uv run scripts/agent.py --model qwen3.5:9b --seed 42 --temperature 0.1 "shoegaze deep cuts"

# Extended thinking
uv run scripts/agent.py --think --max-turns 8 "jazz from my library"

# Batch: run all 29 built-in prompt examples
uv run scripts/agent.py --batch

# Batch with a different model
uv run scripts/agent.py --batch --model qwen3:14b

# Batch from a file (one prompt per line, # comments ignored)
uv run scripts/agent.py --batch --prompts-file prompts.txt
```

Batch mode shares a single DB connection and Ollama client across all prompts,
prints per-prompt results as they complete, and outputs a summary table:

```
================================================================================
BATCH SUMMARY — qwen3.5:9b
================================================================================
#    Result  Time Tracks Artists Turns  C  I  V     H  Prompt
--------------------------------------------------------------------------------
1    PASS     35s     18      18  2/5   2  2  2  2.00  a Sunday morning coffee playlist
2    PASS     20s     12      12  2/5   2  2  2  2.00  artists similar to Radiohead in my library
3    FAIL     45s                  5/5                  tracks with heavy bass lines (parse_failure)
--------------------------------------------------------------------------------
Pass: 2/3 (67%)  Avg time: 33s  Total: 100s  Avg harmonic (pass): 2.00
```

`run_agent()` returns an `AgentResult` dataclass with status, playlist name,
track IDs, valid count, unique artists, turns used, eval scores, harmonic mean,
and elapsed time. `run_batch()` collects these for programmatic use.

## Configuration

All env vars are read from `.env` via `python-decouple`. CLI flags override
env var defaults.

| Env Var | Default | CLI Flag |
|---------|---------|----------|
| `OLLAMA_MODEL` | `qwen3.5:9b` | `--model` |
| `OLLAMA_HOST` | `http://localhost:11434` | `--host` |
| `AGENT_MAX_TURNS` | `5` | `--max-turns` |
| `AGENT_TEMPERATURE` | `0.3` | `--temperature` |
| `AGENT_THINK` | `false` | `--think` |
| `AGENT_SEED` | `0` | `--seed` |
| `AGENT_REPEAT_PENALTY` | `1.1` | `--repeat-penalty` |
| `AGENT_MIN_PLAYLIST_TRACKS` | `12` | — |
| `AGENT_MAX_PLAYLIST_TRACKS` | `25` | — |
| `AGENT_LOG_FILE` | `/tmp/ollama_python_agent.jsonl` | `--log-file` |
| `LASTFM_API_KEY` | — | — |
| — | — | `--batch` |
| — | — | `--prompts-file` |

## Tools

| Tool | Source | Purpose |
|------|--------|---------|
| `get_recently_played` | SQLite | Recent listening habits |
| `get_top_artists` | SQLite | Most-played artists by time range |
| `search_library` | SQLite | Keyword search on title/artist/album |
| `get_track_tags` | Last.fm | Mood/genre tags for a track |
| `get_similar_tracks` | Last.fm + SQLite | Similar tracks cross-referenced with library |
| `get_similar_artists` | Last.fm + SQLite | Similar artists with sample tracks from library |
| `get_top_artists_by_tag` | Last.fm + SQLite | Genre discovery — top artists in a tag, filtered to library |
| `get_top_tracks_by_country` | Last.fm + SQLite | Regional trending tracks in library |

## Evolution — From Naive to Semantic

### Problem: keyword matching is not semantic understanding

The initial implementation used stub tools that returned `[]` for all Last.fm
calls. The model fell back to `search_library` with mood words as keywords,
which matches against title/artist/album text via SQL `LIKE`. This produced
results like:

- **"chill"** matched *Ladyhawke — Chills* (synth-pop, not chill)
- **"calm"** matched *Rage Against the Machine — Calm Like A Bomb* (definitely not calm)
- **"soft"** matched *Spoon — I Could See the Dude* (from album *Soft Effects*)

The model exhausted all 5 turns doing keyword searches and never produced a
playlist.

### Solution: Last.fm tools + strategy-based prompt + actionable hints

Three changes transformed the results:

**1. Real Last.fm tool implementations** — `get_top_artists_by_tag("dream pop")`
now queries Last.fm's tag database and cross-references against the local
library. This finds Beach House, Cocteau Twins, Cigarettes After Sex — artists
that are *actually* dreamy, not just containing the word "dream" in a track title.

**2. Strategy-based system prompt** — Instead of a flat list of tool
descriptions, the prompt routes by request type and enforces artist variety:

```text
- Mood/vibe requests → get_top_artists_by_tag with genre tags IN PARALLEL
- Artist-based requests → get_similar_artists + get_similar_tracks
- Regional requests → get_top_tracks_by_country
- search_library is for specific artist/album/title lookups only

Artist variety rules:
- DEFAULT to 1 track per artist for MAXIMUM variety
- Only add a 2nd track from same artist if you CANNOT find enough unique artists
- PRIORITY: 20 tracks from 20 different artists > 20 tracks from 10 artists with 2 each
```

**3. Actionable empty-result hints** — When a tool returns no matches, it
explains *why* and suggests *what to try next*:

```json
{
  "matches": 0,
  "lastfm_count": 50,
  "hint": "Last.fm returned 50 artists for 'ambient' but none are in your library. Try a broader tag, or use get_similar_artists on an artist you've already found."
}
```

This prevents the model from blindly retrying the same approach. Inspired by
the [Manus agent design post](https://reddit.com/r/LocalLLaMA/comments/1rrisqn/)
on error messages as navigation.

### Results comparison

**Before** (stub tools, naive prompt, temp=0.45):

```jsonl
{"event":"session_start","data":{"temperature":0.45,"prompt":"make me a chill playlist"}}
{"event":"tool_call","data":{"tool":"search_library","args":{"query":"chill"}}}
{"event":"tool_result","data":{"tool":"search_library","count":2,"result":[{"title":"Chills","artist":"Ladyhawke"},{"title":"chill","artist":"deadmau5"}]}}
{"event":"tool_call","data":{"tool":"search_library","args":{"query":"calm"}}}
{"event":"tool_result","data":{"tool":"search_library","count":1,"result":[{"title":"Calm Like A Bomb","artist":"Rage Against the Machine"}]}}
{"event":"session_end","data":{"reason":"exhausted","turns_used":5}}
```

Exhausted 5 turns. Produced a 2-track playlist of keyword matches.

**After** (Last.fm tools, strategy prompt, hints, repeat penalty, temp=0.3):

```jsonl
{"event":"session_start","data":{"temperature":0.3,"repeat_penalty":1.1,"prompt":"make me a chill playlist"}}
{"event":"tool_call","data":{"tool":"get_top_artists_by_tag","args":{"tag":"chillout","limit":50}}}
{"event":"tool_call","data":{"tool":"get_top_artists_by_tag","args":{"tag":"dream pop","limit":50}}}
{"event":"tool_call","data":{"tool":"get_top_artists_by_tag","args":{"tag":"lo-fi","limit":50}}}
{"event":"tool_call","data":{"tool":"get_top_artists_by_tag","args":{"tag":"ambient","limit":50}}}
{"event":"parse_success","data":{"playlist_name":"Velvet Haze","track_ids":[68967,69901,"...12 more"],"valid_count":14}}
{"event":"eval_scores","data":{"concept":2,"instruction":2,"variety":2,"harmonic_mean":2.0}}
{"event":"session_end","data":{"reason":"success","turns_used":2}}
```

14/14 valid tracks in 2 turns, 13 artists. Eval: 2/2 across all criteria.

**Artist variety after shuffling** — The final playlist order spreads same-artist
tracks apart via greedy algorithm:

```
SHUFFLED order (artists spread out):
  [70060] Massive Attack - Angel
  [68658] Beach House - Sparks
  [68669] Car Seat Headrest - Sunburned Shirts
  [68671] Cocteau Twins - Iceblink Luck
  [68709] Grimes - Symphonia IX (My Wait Is U)
  [68734] Alvvays - Dives
  ... (13 different artists, 1 track each)

Summary: 14 tracks, 13 artists, 2/5 turns
```

## Determinism Controls

| Lever | Default | Effect |
|-------|---------|--------|
| `AGENT_TEMPERATURE` | 0.3 | Lower = more deterministic token sampling |
| `top_p` | 0.9 | Nucleus sampling cutoff (hardcoded) |
| `num_predict` | 2048 | Maximum tokens to generate (prevents truncation) |
| `AGENT_REPEAT_PENALTY` | 1.1 | Penalizes repeated tokens to reduce gibberish (CTRL-style) |
| `AGENT_SEED` | 0 (random) | Fixed seed for reproducible output |
| `AGENT_MIN_PLAYLIST_TRACKS` | 12 | Minimum tracks to include in playlist |
| `AGENT_MAX_PLAYLIST_TRACKS` | 25 | Hard cap on output track count |
| `parse_response()` | — | Deduplicates + truncates regardless of model output |
| `_shuffle_spread_artists()` | — | Greedy shuffle to spread same-artist tracks apart |

## LLM-as-Judge Evaluation

After generating a playlist, the agent runs an automated evaluation pass using
the same Ollama model as judge. Inspired by the AxBench metrics from the
[Eiffel Tower Llama](https://huggingface.co/spaces/dlouapre/eiffel-tower-llama)
paper, three criteria are scored 0-2:

| Criterion | What it measures |
|-----------|-----------------|
| **Concept match** | Does the playlist match the requested mood/genre/theme? |
| **Instruction following** | Valid playlist format, correct track count? |
| **Track variety** | Diverse artists vs. repetitive? |

A **harmonic mean** of the three scores penalizes playlists that fail on any
single dimension (e.g. on-theme but all from one artist scores poorly).

Scores are logged to JSONL as `eval_scores` events, enabling A/B comparison
of prompt or parameter changes:

```bash
# Compare harmonic means across runs
jq 'select(.event == "eval_scores") | .data' /tmp/ollama_python_agent.jsonl
```

The evaluation uses `temperature=0.0` for deterministic judging and a 128-token
cap since only three scores are needed.

## Model Selection

The default model is `qwen3.5:9b` — chosen to fit 8GB unified memory devices
(e.g. MacBook Air M3) while maintaining reliable tool calling. Larger models
improve quality and reduce turn count but require more RAM.

### Requirements

The agent needs a model that can:

- Make **parallel tool calls** (multiple tools in a single turn)
- Follow a complex 8-tool system prompt with strategy routing
- Produce structured output (`Playlist: name` / `Tracks: comma-separated IDs`)
- Reason about user intent to select the right tool combination

Models below ~4B parameters (e.g. llama3.2:1b) lack the reasoning capacity for
this task. Parallel tool calling support in Ollama is required — models that only
support single tool calls per turn (e.g. gpt-oss) double the number of turns needed.

### Recommended models by device RAM

| Device RAM | Model | Size (Q4) | Active Params | Notes |
|------------|-------|-----------|---------------|-------|
| 8GB | `qwen3.5:9b` | ~7GB | 9B dense | Default. Fits tight but works |
| 8GB | `qwen3:8b` | ~5GB | 8B dense | Fallback if 3.5 has issues |
| 16GB | `qwen3:14b` | ~9GB | 14B dense | Highest tool F1 (0.971) |
| 32GB+ | `qwen3-coder:30b-a3b` | ~18GB | 3B active (MoE) | Fast inference, good quality |
| 32GB+ | `glm-4.7-flash` | ~19GB | dense | Strong agent benchmarks |

Sticking with the Qwen family across tiers keeps prompt behavior consistent —
same tool calling format, same instruction following patterns.

### Benchmark: 29 prompt examples (2026-04-04)

Tested all 29 prompt examples from `genius-browser.js` against `qwen3.5:9b`
with default settings. Full results in TASK-309.

**Overall: 26/29 pass (89.7%), 3 parse failures, 0 errors**

The 3 failures share a root cause: the model dumps 50-100+ track IDs then
loops trying to self-correct, never producing clean `Playlist:` / `Tracks:`
output. Affected prompts: "tracks with heavy bass lines", "melancholy but
beautiful tracks", "blues and classic rock deep cuts".

Two prompts scored Concept=0 due to library coverage gaps (no jazz/soul or
hip-hop/R&B in the test library) — the model correctly identified the gap
and fell back to related genres.

### Model comparison on failure cases

Tested the 3 failed prompts + 2 reference prompts across larger models:

| Prompt | qwen3.5:9b | qwen3-coder:30b-a3b | glm-4.7-flash | qwen3.5:35b-a3b |
|--------|-----------|---------------------|---------------|-----------------|
| tracks with heavy bass lines | **FAIL** | PASS 42s H=2.00 | PASS 46s H=2.00 | PASS 60s H=1.50 |
| melancholy but beautiful | **FAIL** | PASS 39s H=1.50 | PASS 75s H=2.00 | PASS 46s H=2.00 |
| blues/classic rock deep cuts | **FAIL** | PASS 26s H=1.20 | PASS 58s H=1.50 | PASS 68s H=1.20 |
| chill playlist | PASS ~30s H=2.00 | PASS 38s H=1.50 | PASS 47s H=2.00 | PASS 27s H=2.00 |
| similar to Radiohead | PASS ~30s H=2.00 | PASS 23s H=2.00 | PASS 25s H=2.00 | PASS 41s H=2.00 |

All 3 larger models pass the prompts that `qwen3.5:9b` failed — the failures
are a reasoning/self-control issue at 9B scale, not a tool calling issue.

`qwen3-coder:30b-a3b` (MoE, 3B active) is the fastest larger model due to low
active parameter count on Apple Silicon. `glm-4.7-flash` has the most
consistent eval scores. `qwen3.5:35b-a3b` was slower than expected and did not
improve over the other two.

### Speed observations

End-to-end prompt completion time is dominated by **number of turns**, not raw
token speed. A model completing in 2 turns at 30 tok/s beats a model needing 5
turns at 100 tok/s. The primary optimization path is reducing turn count through
better prompt engineering, not switching to faster models.

## Applying to Rust Backend

The script mirrors the Rust agent in `crates/mt-tauri/src/agent/`:

| Python (`scripts/agent.py`) | Rust (`crates/mt-tauri/src/agent/`) |
|------------------------------|--------------------------------------|
| `_build_system_prompt()` | `prompt.rs::SYSTEM_PROMPT` |
| `TOOLS` list | `tools.rs` (8 `impl Tool` structs) |
| `tool_get_similar_tracks()` | `tools.rs::GetSimilarTracks::call()` |
| `_lastfm_get()` | `lastfm/client.rs::api_call()` |
| `parse_response()` | `mod.rs::parse_agent_response()` |
| `run_agent()` → `AgentResult` | `mod.rs::agent_generate_playlist()` |
| `run_batch()` | — (Python-only test harness) |
| `_connect()` | Managed by Tauri app state |
| `BATCH_PROMPTS` | — (Python-only test data) |

Changes validated in the Python script should be ported to Rust:

1. **System prompt** — Copy the strategy-based prompt to `prompt.rs` with artist variety rules
2. **Actionable hints** — Add hint metadata to Rust tool `Output` types
3. **Default limits** — Increase `get_top_artists_by_tag` default from 10 to 50
4. **Hard cap** — Add dedup + truncation to `parse_agent_response()`
5. **Temperature/seed/repeat_penalty** — Pass through Ollama options in `build_agent()`
6. **Token limit** — Set `max_tokens: 2048` in `build_agent()` to prevent response truncation
7. **Track shuffling** — Port `_shuffle_spread_artists()` greedy algorithm to shuffle playlist order
8. **Last-turn nudge** — Inject "output now" message on final turn to prevent exhaustion
9. **Creative naming** — Port synonym-based playlist naming instructions to `prompt.rs`
