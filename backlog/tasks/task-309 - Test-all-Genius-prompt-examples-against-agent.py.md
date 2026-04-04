---
id: TASK-309
title: Test all Genius prompt examples against agent.py
status: Done
assignee: []
created_date: '2026-04-04 04:07'
updated_date: '2026-04-04 04:40'
labels:
  - testing
  - genius
  - agent
dependencies: []
references:
  - app/frontend/js/components/genius-browser.js
  - scripts/agent.py
  - docs/agent.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Run each of the 29 prompt examples from `app/frontend/js/components/genius-browser.js` through `scripts/agent.py` using the default qwen3.5:9b model. Record which prompts succeed (valid playlist generated) and which fail (parse failure, no matches, bad output). This establishes a baseline for prompt coverage against the current library.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All 29 prompt examples tested against agent.py with qwen3.5:9b
- [x] #2 Results documented: pass/fail status, track count, artist variety, eval scores
- [x] #3 Known failures identified (e.g. genres not well-represented in library)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Results: 26/29 pass (89.7%), 3 parse failures, 0 errors

### Full Results (qwen3.5:9b, default settings)

| # | Prompt | Result | Tracks | Artists | Turns | C | I | V | H |
|---|--------|--------|--------|---------|-------|---|---|---|---|
| 1 | make me a chill playlist from my library | PASS | 15 | 15 | 2/5 | 2 | 2 | 2 | 2.00 |
| 2 | something similar to what I listened to recently | PASS | 25 | 24 | 3/5 | 2 | 2 | 2 | 2.00 |
| 3 | find me post-punk artists I don't usually listen to | PASS | 25 | 7 | 2/5 | 2 | 2 | 1 | 1.50 |
| 4 | upbeat tracks for a morning run | PASS | 20 | 19 | 4/5 | 1 | 2 | 2 | 1.50 |
| 5 | rainy day songs with acoustic guitars | PASS | 17 | 17 | 3/5 | 2 | 2 | 2 | 2.00 |
| 6 | deep cuts I haven't played in months | PASS | 25 | 6 | 3/5 | 2 | 2 | 1 | 1.50 |
| 7 | a late-night driving mix | PASS | 20 | 9 | 3/5 | 2 | 2 | 2 | 2.00 |
| 8 | something moody and atmospheric | PASS | 20 | 20 | 4/5 | 2 | 2 | 2 | 2.00 |
| 9 | high energy tracks for cleaning the house | PASS | 25 | 6 | 2/5 | 2 | 2 | 2 | 2.00 |
| 10 | jazz and soul from the 60s and 70s | PASS | 25 | 5 | 5/5 | 0 | 2 | 2 | 0.00 |
| 11 | songs that build slowly then explode | PASS | 24 | 15 | 2/5 | 2 | 2 | 2 | 2.00 |
| 12 | artists similar to Radiohead in my library | PASS | 20 | 16 | 2/5 | 2 | 2 | 2 | 2.00 |
| 13 | a Sunday morning coffee playlist | PASS | 18 | 18 | 2/5 | 2 | 2 | 2 | 2.00 |
| 14 | tracks with heavy bass lines | FAIL | - | - | - | - | - | - | - |
| 15 | my most played songs from this year | PASS | 25 | 16 | 5/5 | 2 | 2 | 0 | 0.00 |
| 16 | something dreamy and shoegaze-y | PASS | 12 | 11 | 2/5 | 2 | 2 | 2 | 2.00 |
| 17 | a workout mix that keeps escalating | PASS | 25 | 8 | 3/5 | 2 | 2 | 2 | 2.00 |
| 18 | underrated albums I barely touched | PASS | 24 | 24 | 4/5 | 2 | 2 | 2 | 2.00 |
| 19 | folksy singer-songwriter vibes | PASS | 20 | 20 | 5/5 | 2 | 2 | 2 | 2.00 |
| 20 | electronic music that isn't too intense | PASS | 23 | 20 | 4/5 | 2 | 2 | 2 | 2.00 |
| 21 | songs to cook dinner to | PASS | 25 | 7 | 3/5 | 2 | 2 | 2 | 2.00 |
| 22 | a road trip playlist from my collection | PASS | 25 | 21 | 2/5 | 2 | 2 | 2 | 2.00 |
| 23 | melancholy but beautiful tracks | FAIL | - | - | - | - | - | - | - |
| 24 | hip-hop and R&B from the 90s | PASS | 25 | 16 | 5/5 | 0 | 2 | 2 | 0.00 |
| 25 | everything by female vocalists | PASS | 13 | 10 | 5/5 | 2 | 2 | 2 | 2.00 |
| 26 | instrumental tracks only | PASS | 25 | 9 | 5/5 | 2 | 2 | 1 | 1.50 |
| 27 | songs under three minutes | PASS | 20 | 16 | 4/5 | 2 | 2 | 2 | 2.00 |
| 28 | a party mix from what I already have | PASS | 12 | 11 | 2/5 | 2 | 2 | 2 | 2.00 |
| 29 | blues and classic rock deep cuts | FAIL | - | - | - | - | - | - | - |

### Failure Analysis

All 3 failures share the same root cause: **model dumps 50-100+ track IDs then tries to self-correct multiple times**, never producing a clean single-line `Playlist:` / `Tracks:` output. The `**Playlist:**` markdown bold formatting also breaks the parser.

- **#14 "tracks with heavy bass lines"** — model found many matching tracks, dumped all IDs, then looped trying to reduce the list
- **#23 "melancholy but beautiful tracks"** — same pattern, 130+ IDs dumped, repeated failed attempts to curate
- **#29 "blues and classic rock deep cuts"** — model listed tracks in prose format instead of using Playlist:/Tracks: format

### Library Coverage Gaps (Concept score = 0)

- **#10 "jazz and soul from the 60s and 70s"** — library has no jazz/soul, model fell back to post-punk from that era
- **#24 "hip-hop and R&B from the 90s"** — library has no hip-hop/R&B, model fell back to 90s alternative/indie

### Low Variety Scores

- **#3 "post-punk artists"** — 25 tracks from only 7 artists (too many per artist)
- **#6 "deep cuts"** — 25 tracks from 6 artists
- **#15 "most played this year"** — Variety=0, 25 tracks from 16 artists (judge was harsh)
- **#26 "instrumental tracks"** — 25 tracks from 9 artists

### Raw output saved to `/tmp/genius_prompt_results/`
<!-- SECTION:FINAL_SUMMARY:END -->
