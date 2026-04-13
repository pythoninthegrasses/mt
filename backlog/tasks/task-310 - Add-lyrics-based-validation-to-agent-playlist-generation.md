---
id: TASK-310
title: Add lyrics-based validation to agent playlist generation
status: To Do
assignee: []
created_date: '2026-04-04 08:54'
updated_date: '2026-04-13 04:00'
labels:
  - agent
  - quality
  - bug
dependencies: []
references:
  - src-tauri/src/agent.rs
  - docs/agent.md
priority: medium
ordinal: 51500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The local LLM (qwen) hallucinated when given the prompt "instrumental tracks only" -- it returned a playlist of 22 tracks (named "Instrumental Horizons") that are overwhelmingly vocal tracks (Ellie Goulding, Grimes, Weezer, Mother Mother, Cults, etc.). The model has no way to determine whether a track is actually instrumental; it just matched Last.fm tags like "instrumental", "post-rock", "electronic" and assumed those artists' tracks are instrumental.

Since the LLM cannot be trusted to make this determination from Last.fm metadata alone, add a post-generation validation step that uses the existing lyrics lookup (lrclib) to check whether each track in the generated playlist actually has lyrics. If lyrics are found, the track is not instrumental and should be filtered out.

This applies specifically to prompts that request instrumental/no-vocals content, not to all playlist generation.

**Observed behavior (2026-04-04):**
- Prompt: "instrumental tracks only"
- Result: 22 tracks, nearly all with vocals
- Artists included: Ellie Goulding, Grimes, Weezer, Cults, MGMT, Mother Mother -- none instrumental
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When the agent prompt implies instrumental-only tracks, each candidate track is checked for lyrics before inclusion
- [ ] #2 Check the local SQLite db for cached lyrics first -- if the track has been played before, lyrics should already be stored
- [ ] #3 Only call the lrclib API for tracks with no cached lyrics in the db
- [ ] #4 Tracks with lyrics found (cached or fetched) are excluded from the final playlist
- [ ] #5 Tracks where no lyrics exist (or lrclib returns instrumental flag) are kept
- [ ] #6 The validation does not run for non-instrumental prompts (no performance penalty for normal playlists)
- [ ] #7 If filtering removes too many tracks, the agent is informed and can search for more candidates
<!-- AC:END -->
