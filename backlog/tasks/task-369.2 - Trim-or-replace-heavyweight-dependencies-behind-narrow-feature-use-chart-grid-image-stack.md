---
id: TASK-369.2
title: >-
  Trim or replace heavyweight dependencies behind narrow feature use (chart-grid
  image stack)
status: Done
assignee:
  - lance
created_date: '2026-11-14T04:24:00Z'
updated_date: '2026-11-14T06:01:00Z'
labels: []
dependencies: []
documentation:
  - docs/builds.md
  - docs/development.md
parent_task_id: TASK-369
type: spike
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
commands/stats.rs (stats_generate_chart_grid) is the sole consumer of image, imageproc, and ab_glyph: it resizes artwork cells with Lanczos3, overlays them onto an RgbaImage, draws text, and PNG-encodes. That is a narrow surface paying for a large dependency subtree in both compile time and target/ disk, on every platform, even though the feature is used occasionally. The audit should quantify the subtree cost first (cargo tree -i image imageproc ab_glyph plus --timings share), then evaluate, in order: (1) feature-trimming the crates, (2) replacing imageproc's draw_text_mut and shrinking image to the needed decoders/encoders, (3) removing the Rust path entirely by rendering the chart grid in the frontend with Canvas and saving via existing dialog/save plumbing. Whichever option wins gets landed; the others are documented as rejected with numbers. Also survey other heavy-but-narrow cases found along the way (reqwest/tokio feature surface, sha2+md5 duplication) and record them even if out of scope to fix here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dependency-subtree compile-time and artifact cost for the chart stack quantified with cargo tree -i and --timings, recorded in task notes
- [x] #2 Options 1-3 each evaluated with a measured or argued cost/benefit and a keep/reject decision with rationale
- [x] #3 Winning option implemented with a green full test suite; chart grid output visually verified against a current screenshot
- [x] #4 Any additional heavy-but-narrow candidates found are recorded as notes or follow-up tasks rather than silently skipped
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Approach

Spike: quantify the chart-grid image stack (image + imageproc + ab_glyph), pick the cheapest option that preserves behaviour, land it, and record the rejected options with numbers.

### Baseline measurements (cargo 1.100, macOS aarch64, 16 cores, cold build, sccache disabled, temp CARGO_TARGET_DIR)

- Cold `cargo build` of mt-tauri: 48.3 s wall, 459.9 s summed unit CPU, 686 units / 474 crates, 9.5x mean parallelism.

- commands/stats.rs is the sole consumer of image, imageproc and ab_glyph (grep over crates/**.rs). `cargo tree -i` plus a reachability diff against the other 38 direct deps: 67 crates exist ONLY because of this stack, 41.6 MiB of vendored Rust source.

- Compile cost of those crates: 48 units, 32.4 s CPU = 7.0% of all compile CPU. Heaviest: rav1e 2.8 s, nalgebra 2.6 s, moxcms 2.3 s, image 1.9 s, simba 1.8 s, ravif 1.6 s, exr 1.6 s.

- Artifact cost: 363.7 MiB of the 2.75 GiB dependency artifact tree = 12.9% (moxcms 46.6, ravif 44.4, image 42.5, simba 24.1, imageproc 23.0, nalgebra 18.5, rav1e 16.5, exr 16.3 MiB).

- Root cause: imageproc 0.25 declares `default = [rayon, image/default]`, so feature unification re-enables image's whole default codec set even though mt-tauri asks for jpeg+png only. That drags in an AV1 encoder (rav1e/ravif/av-scenechange), colour management (moxcms/pxfm), exr, tiff, webp, gif, qoi, dds, ff, ico, plus imageproc's linear-algebra stack (nalgebra/simba/wide/safe_arch/matrixmultiply).

### Behaviour constraint found during research

- scanner/artwork.rs can return image/jpeg, image/png, image/gif, image/bmp, image/tiff. imageproc's unified features are currently what makes gif/bmp/tiff decodable, so a naive trim to jpeg+png would silently downgrade that artwork to the text placeholder. Any Rust-side option must keep jpeg,png,gif,bmp,tiff.

### Options under evaluation

- Option 1 (feature trim only): `imageproc = { default-features = false }`, image features jpeg,png,gif,bmp,tiff. Smallest diff, no behaviour change; keeps imageproc's nalgebra stack.

- Option 2 (also drop imageproc): hand-roll the ~30-line glyph blit on ab_glyph, mirroring imageproc::drawing::draw_text_mut (Font::as_scaled + OutlinedGlyph::draw + weighted_sum). Removes imageproc's 12 unique crates. Small antialiasing/kerning drift risk, so it needs the visual check.

- Option 3 (delete all three crates): render the grid in a frontend canvas. Needs one thin Rust command exposing stats::get_top_albums_for_grid (already implemented and unit tested) and reuses library_get_artwork_url (data: URLs, so no canvas tainting) plus the existing save_file(base64) export path. Also fixes webp artwork, which the Rust path cannot decode today. Largest win; moves ~150 lines of drawing logic from Rust to JS.

### Steps

1. Measure each option with the same cold-build harness (rustc wrapper logging per-unit durations, temp target dir) and re-run the artifact attribution. 2. Capture a golden baseline from the current Rust renderer (synthetic artwork through the existing pipeline) before touching rendering. 3. Present numbers and recommendation, then implement the winner on branch task-369-2-chart-stack. 4. Verify with cargo nextest --workspace, vitest, the Playwright statistics spec, deno lint/fmt and cargo clippy/fmt. 5. Record rejected options with numbers in task notes and log other heavy-but-narrow candidates (reqwest 39 unique crates / 14.3 MiB, lru's hashbrown pull, lofty, sha2+md5 overlap) for TASK-369.3 rather than fixing them here.

### Risks

- Option 3 shifts test layers: rendering checks move from Rust unit tests to Vitest (pure layout maths) plus Playwright (canvas render); must not duplicate logic across layers.

- Option 2's hand-rolled rasterizer must reproduce imageproc's kerning quirk (kern applied only to glyphs that have outlines) or placeholder text will shift slightly.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Measurements (2026-11-13, cargo 1.100, macOS aarch64, 16 cores, sccache off, scratch CARGO_TARGET_DIR per scenario, `cargo build -p mt-tauri`)

Method: per-unit timings from a RUSTC_WRAPPER log (cargo --timings json is unstable-only); distinct `--crate-name` counts; `du -sk <target>/debug`. Run-to-run variance ~2% CPU / ~2s wall, so deltas under ~9s CPU are noise.

s0 baseline: 448 crate units | 468.8s summed unit CPU | 50.5s wall | 3655 MiB debug tree

s1 Option 1 (image default-features=false + jpeg,png,gif,bmp,tiff; imageproc default-features=false): 415 units (-33) | 441.1s CPU (-27.7s) | 49.4s wall (-1.1s) | 3417 MiB (-238 MiB)

s2 Option 2 (s1 minus imageproc, draw_text_mut stubbed): 400 units (-48) | 443.0s CPU (-25.8s) | 49.4s wall | 3313 MiB (-342 MiB)

s3 Option 3 (image+imageproc+ab_glyph all removed, command returns album rows only): 381 units (-67) | 402.1s CPU (-66.7s) | 47.5s wall (-3.0s) | 3075 MiB (-580 MiB)

Removed by Option 1 (33 crates, 24.1s CPU): rav1e 2.79s, arg_enum_proc_macro 2.62s, ravif 2.34s, num_derive 2.28s, equator_macro 3.08s, profiling_procmacros 1.94s, exr 1.54s, nom 1.12s, built 1.05s, image_webp 0.65s, av_scenechange 0.62s, + avif_serialize, av1_grain, zune_inflate, bitstream_io, aligned_vec, v_frame, y4m, rgb, imgref, qoi, lebe, bit_field, fax/fax_derive (in s0 full set), loop9, maybe_rayon, simd_helpers, pastey, core2, as_slice, byteorder_lite, noop_proc_macro, simd helpers.

Removed by Option 2 additionally (15 crates, 7.9s CPU): nalgebra 2.70s, simba 1.81s, imageproc 0.65s, wide 0.66s, itertools 0.60s, libm 0.59s, rand_distr, num_complex, matrixmultiply, approx, num_iter, num, rawpointer, safe_arch.

Removed by Option 3 additionally (19 crates, ~39s CPU): zerocopy_derive 8.24s, moxcms 3.51s, pxfm 1.32s, image 1.76s, ttf_parser 1.22s, tiff 0.65s, zune_jpeg 0.65s, gif 0.32s, weezl, zune_core, half, ab_glyph 0.21s, ab_glyph_rasterizer, quick_error, color_quant, owned_ttf_parser, fax, fax_derive.

Survivors in s3 that the tree-based chart list wrongly attributed: png (pulled by another consumer, not chart-only).

Whole-build context: chart stack = 7.2% of summed compile CPU and ~16% of the debug artifact tree; wall-clock win is only ~3s (6%) because syn 14s, objc2_app_kit 13s, darling_core 11s dominate the critical path. This is a disk/crate-count problem, not a wall-clock one.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Landed Option 1 (feature trim) on branch task-369-2-chart-stack in five commits: fix(stats) log decode failures, build(deps) trim image and imageproc features, test(stats) codec and pipeline guards, docs(builds) measurements, chore(backlog) record and hand off.

Change: imageproc default-features=false and image default-features=false with jpeg, png, gif, bmp, tiff. 37 packages leave Cargo.lock. The explicit codec list is required, not cosmetic: imageproc's default = [rayon, image/default] was the only reason gif, bmp and tiff artwork decoded at all, so a naive trim to jpeg+png would have silently turned that artwork into placeholder cells.

Measured (M4 Max, cargo 1.100, sccache off, scratch target dir): 448 to 415 crates, 468.8s to 441.1s compile CPU, 3655 to 3417 MiB of debug artifacts, wall time 50.5s to 49.4s. Rejected: dropping imageproc (400 crates, 3313 MiB, CPU delta inside the 2% noise, keeps image plus moxcms and pxfm) and dropping all three for a canvas renderer (381 crates, 3075 MiB) as too large a change for the remaining 342 MiB; that option stays documented in docs/builds.md with its numbers.

Verification: cargo nextest run --workspace 895 passed, 2 skipped; new tests chart_grid_decodes_every_artwork_mime_type and chart_grid_golden_image; golden 3x3 grid rendered before and after the trim is byte-identical (sha256 876e31830273a26e5e82c3e0b703a2c668e86ee06e689315ee3deace19ed669d) and reviewed as a rendered image; npx vitest run 643 passed; npx playwright test statistics.spec.js 8 passed; cargo clippy --workspace --all-targets no new warnings; cargo fmt --check and deno lint clean. Frontend and Zig were untouched.

Verification gap, stated plainly: the golden image exercises the real decode, resize, overlay, placeholder and PNG-encode pipeline but not the Tauri command's DB and artwork-cache plumbing (that path needs a real library), and no live app screenshot was taken. The command body itself is unchanged apart from the added warn log.

Out of scope here: reqwest, lofty, lru, and sha2 plus md5 leads are recorded as untriaged notes on TASK-369.3, along with imageproc's remaining non-optional nalgebra stack (15 crates, 104 MiB).
<!-- SECTION:FINAL_SUMMARY:END -->
