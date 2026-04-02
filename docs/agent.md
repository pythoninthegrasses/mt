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

- **System prompt** — `_build_system_prompt(max_tracks)` generates a dynamic
  prompt with strategy routing (mood, artist, regional, mixed) and
  interpolated track count bounds.
- **8 tools** — 3 local (SQLite) + 5 Last.fm (httpx → cross-ref with library).
  All tools return actionable hints on empty results to guide the model's
  next action.
- **JSONL logging** — Every session, turn, tool call, result, and parse
  outcome is logged to a structured JSONL file for analysis.
- **Hard cap** — `parse_response()` deduplicates and truncates track IDs to
  `MAX_PLAYLIST_TRACKS` regardless of model output.

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
descriptions, the prompt routes by request type:

```text
- Mood/vibe requests → get_top_artists_by_tag with genre tags IN PARALLEL
- Artist-based requests → get_similar_artists + get_similar_tracks
- Regional requests → get_top_tracks_by_country
- search_library is for specific artist/album/title lookups only
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

**After** (Last.fm tools, strategy prompt, hints, temp=0.2, seed=42):

```jsonl
{"event":"session_start","data":{"temperature":0.2,"seed":42,"prompt":"make me a chill playlist"}}
{"event":"tool_call","data":{"tool":"get_top_artists_by_tag","args":{"tag":"chillout","limit":50}}}
{"event":"tool_call","data":{"tool":"get_top_artists_by_tag","args":{"tag":"dream pop","limit":50}}}
{"event":"tool_call","data":{"tool":"get_top_artists_by_tag","args":{"tag":"shoegaze","limit":50}}}
{"event":"tool_result","data":{"tool":"get_top_artists_by_tag","count":6}}
{"event":"tool_call","data":{"tool":"get_similar_tracks","args":{"artist":"Cigarettes After Sex","track":"K."}}}
{"event":"tool_call","data":{"tool":"get_similar_tracks","args":{"artist":"Beach House","track":"Sparks"}}}
{"event":"parse_success","data":{"playlist_name":"Chill Vibes Collection","track_ids":[69727,70192,71486,"...21 more"],"valid_count":25}}
{"event":"session_end","data":{"reason":"success","turns_used":4}}
```

25/25 valid tracks in 4 turns. Artists: Beach House, Cocteau Twins,
Cigarettes After Sex, Alvvays, girl in red, The Radio Dept., M83, Grimes.

## Determinism Controls

| Lever | Default | Effect |
|-------|---------|--------|
| `AGENT_TEMPERATURE` | 0.2 | Lower = more deterministic token sampling |
| `top_p` | 0.9 | Nucleus sampling cutoff (hardcoded) |
| `AGENT_SEED` | 0 (random) | Fixed seed for reproducible output |
| `AGENT_MAX_PLAYLIST_TRACKS` | 25 | Hard cap on output track count |
| `parse_response()` | — | Deduplicates + truncates regardless of model output |

## Applying to Rust Backend

The script mirrors the Rust agent in `crates/mt-tauri/src/agent/`:

| Python (`scripts/agent.py`) | Rust (`crates/mt-tauri/src/agent/`) |
|------------------------------|--------------------------------------|
| `_build_system_prompt()` | `prompt.rs::SYSTEM_PROMPT` |
| `TOOLS` list | `tools.rs` (8 `impl Tool` structs) |
| `tool_get_similar_tracks()` | `tools.rs::GetSimilarTracks::call()` |
| `_lastfm_get()` | `lastfm/client.rs::api_call()` |
| `parse_response()` | `mod.rs::parse_agent_response()` |
| `run_agent()` loop | `mod.rs::agent_generate_playlist()` |

Changes validated in the Python script should be ported to Rust:

1. **System prompt** — Copy the strategy-based prompt to `prompt.rs`
2. **Actionable hints** — Add hint metadata to Rust tool `Output` types
3. **Default limits** — Increase `get_top_artists_by_tag` default from 10 to 50
4. **Hard cap** — Add dedup + truncation to `parse_agent_response()`
5. **Temperature/seed** — Pass through Ollama options in `build_agent()`

## Usage

```bash
# Basic
uv run scripts/agent.py "make me a chill playlist"

# With options
uv run scripts/agent.py --model qwen3.5:9b --seed 42 --temperature 0.1 "shoegaze deep cuts"

# Extended thinking
uv run scripts/agent.py --think --max-turns 8 "jazz from my library"
```

## Configuration

All env vars are read from `.env` via `python-decouple`. CLI flags override
env var defaults.

| Env Var | Default | CLI Flag |
|---------|---------|----------|
| `OLLAMA_MODEL` | `qwen3.5:9b` | `--model` |
| `OLLAMA_HOST` | `http://localhost:11434` | `--host` |
| `AGENT_MAX_TURNS` | `5` | `--max-turns` |
| `AGENT_TEMPERATURE` | `0.2` | `--temperature` |
| `AGENT_THINK` | `false` | `--think` |
| `AGENT_SEED` | `0` | `--seed` |
| `AGENT_MAX_PLAYLIST_TRACKS` | `25` | — |
| `AGENT_LOG_FILE` | `/tmp/ollama_python_agent.jsonl` | `--log-file` |
| `LASTFM_API_KEY` | — | — |
