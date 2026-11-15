# Zig-first ownership inventory: registered commands

Baseline `205a968`, 2026-11-15: **142** entries in
`crates/mt-tauri/src/lib.rs`'s `generate_handler!`, not the old documented 91.
Disabled-agent branches implement the same six names; they are not six extra
registrations. Plugin-provided window/dialog/store APIs are outside that macro
and covered by the [module/capability](zig-first-ownership.md) and
[frontend](zig-first-frontend.md) inventories.

`Z` = Zig domain operation: move consumers to engine HTTP and delete the old
Tauri registration/wrapper after transfer. `Z/R` = Zig operation using a private
Rust primitive: likewise delete the public domain command; retain only the
named capability. `R` = shell action retained as Tauri invoke. `R-private` =
retain native capability but remove browser session authority/public wrapper.
Task suffixes mean TASK-393; `329` means TASK-329.

Every row specifies the consumer family, final owner and deletion/retention.
No row is permission to remove a command before transferring its callers/tests.

| Command | Consumers | Final owner / disposition | Task |
|---------|-----------|---------------------------|------|
| `audio_load` | player store / audio API | Z/R: audio primitive, source/session chosen by Zig | .13, .19, 329 |
| `audio_load_and_play` | player, queue playback sink | Z/R: load/play primitive only | .13, .14, .22, 329 |
| `audio_play` | player controls | Z/R | .13, 329 |
| `audio_pause` | player controls | Z/R | .13, 329 |
| `audio_stop` | player controls | Z/R | .13, 329 |
| `audio_seek` | player controls | Z/R | .13, 329 |
| `audio_set_volume` | player controls/settings | Z/R | .13, .7, 329 |
| `audio_get_volume` | player/settings hydration | Z/R: session observation | .13, 329 |
| `audio_get_status` | player hydration | Z/R: observed audio feeds Zig snapshot | .13, 329 |
| `audio_list_devices` | audio API/settings | Z/R: CPAL/device isolation | .13 |
| `audio_set_device` | audio API/settings | Z/R: preference in Zig | .13, .7 |
| `open_file_dialog` | UI pickers/missing-track locate | R: native selection/grant only | .3, .27 |
| `open_folder_dialog` | settings/add-folder UI | R: native selection/grant only | .3, .27 |
| `open_add_music_dialog` | library/add/drop UI | R: native selection, Zig scans | .3, .16 |
| `media_set_metadata` | player Now Playing publication | R-private: souvlaki, consume Zig snapshot | .13, 329 |
| `media_set_playing` | player Now Playing publication | R-private: consume Zig state | .13, 329 |
| `media_set_paused` | player Now Playing publication | R-private: consume Zig state | .13, 329 |
| `media_set_stopped` | player Now Playing publication | R-private: consume Zig state | .13, 329 |
| `app_get_info` | settings/about/diagnostics | R: build/platform metadata | .27 |
| `sidecar_get_endpoint` | main.js API bootstrap | R: verified ready endpoint only | .2 |
| `export_diagnostics` | settings export | R: bounded redacted logs, explicit destination grant | .27 |
| `save_file` | chart export | R: bounded bytes to user-approved destination, not arbitrary engine file I/O | .3, .24 |
| `log_frontend_error` | error reporter/web vitals | R: redacted diagnostics | .27 |
| `get_track_metadata` | metadata modal | Z/R: track authorization/workflow then Lofty | .15, .30 |
| `get_tracks_metadata_batch` | metadata modal | Z/R: bounded batch workflow then Lofty | .15, .30 |
| `save_track_metadata` | metadata modal | Z/R: validate/write/reconcile/invalidate | .15, .30 |
| `watched_folders_list` | settings/library API | Z | .7 |
| `watched_folders_get` | settings/library API | Z | .7 |
| `watched_folders_add` | settings/drop/library | Z | .7 |
| `watched_folders_update` | settings | Z | .7, .18 |
| `watched_folders_remove` | settings | Z | .7, .18 |
| `watched_folders_rescan` | settings | Z: scan job, not watcher-local SQL | .16, .18 |
| `watched_folders_status` | settings progress | Z: observed watcher status via capability | .18 |
| `scan_paths_to_library` | library/drop/add-folder | Z: scan jobs and ingestion | .16 |
| `scan_paths_metadata` | library/drop | Z/R: engine batch, Lofty parser | .15, .16 |
| `extract_file_metadata` | library/metadata consumers | Z/R: engine request, parser primitive | .15, .16 |
| `get_track_artwork` | library/player image clients | Z/R: shared resolver | .15, .29 |
| `get_track_artwork_url` | library/player image clients | Z/R: shared resolver/display reference | .15, .29 |
| `library_get_all` | library API, query consumers/shadow harness | Z: remove redundant Rust read path | .4 |
| `library_get_count` | library API | Z | .4 |
| `library_get_section` | library/artist/album/playlist view | Z | .5 |
| `library_find_offset` | type-to-jump | Z: preserve offset API | .5 |
| `library_find_track_offset` | go-to-track | Z: preserve offset API | .5 |
| `library_get_stats` | library totals | Z | .4 |
| `library_get_track` | library/player/queue | Z | .5 |
| `library_get_artwork` | artwork consumers | Z/R: shared resolver | .29 |
| `library_get_artwork_url` | artwork consumers | Z/R: shared resolver | .29 |
| `library_delete_all` | library UI | Z: library rows, not source unlink | .10 |
| `library_delete_track` | library UI | Z | .10 |
| `library_delete_tracks` | library UI | Z | .10 |
| `library_purge_missing` | library/settings UI | Z | .10, .17 |
| `library_rescan_track` | context menu/metadata | Z/R: refresh through parser + reconcile | .10, .16, .30 |
| `library_update_play_count` | player/session/history | Z | .11, 329 |
| `library_get_missing` | missing-track UI | Z | .5 |
| `library_locate_track` | missing-track UI | Z: explicit source repair | .10 |
| `library_check_status` | missing-track UI | Z: source policy, OS observation if needed | .10, .17 |
| `library_mark_missing` | library UI | Z | .10 |
| `library_mark_present` | library UI | Z | .10 |
| `library_reconcile_scan` | settings/library | Z: reconciliation job | .17 |
| `queue_get` | queue API/store | Z | .14 |
| `queue_add` | queue API/menus | Z | .14 |
| `queue_add_files` | drop/queue API | Z | .14 |
| `queue_remove` | queue UI | Z | .14 |
| `queue_clear` | queue UI/startup | Z | .14 |
| `queue_reorder` | queue drag UI | Z | .14 |
| `queue_shuffle` | queue UI | Z | .14 |
| `queue_get_playback_state` | queue hydration/player | Z | .14, 329 |
| `queue_set_current_index` | queue UI/player | Z | .14 |
| `queue_set_shuffle` | player/queue UI | Z | .14 |
| `queue_set_loop` | player/queue UI | Z | .14 |
| `queue_add_play_next` | menus/player/queue | Z | .14 |
| `queue_play_next_track` | end-of-track/player | Z: one navigation authority | .14 |
| `queue_play_previous_track` | player controls | Z | .14 |
| `queue_skip_next` | player controls | Z | .14 |
| `queue_skip_previous` | player controls | Z | .14 |
| `queue_check_integrity` | queue store | Z | .14 |
| `queue_play_context` | library/album/artist/playlist double click | Z | .14 |
| `queue_play_context_query` | filtered library double click | Z | .14 |
| `playlist_list` | sidebar/menu API | Z | .9 |
| `playlist_create` | sidebar/menu/agent | Z | .9 |
| `playlist_get` | playlist/library API | Z | .9 |
| `playlist_update` | sidebar rename | Z | .9 |
| `playlist_delete` | sidebar | Z | .9 |
| `playlist_add_tracks` | menus/drop/agent | Z | .9 |
| `playlist_remove_track` | playlist UI | Z | .9 |
| `playlist_reorder_tracks` | playlist track drag | Z | .9 |
| `playlists_reorder` | sidebar drag | Z | .9 |
| `playlist_generate_name` | sidebar/menu/agent | Z | .9 |
| `favorites_get` | liked section/API | Z | .8 |
| `favorites_check` | player/menu | Z | .8 |
| `favorites_add` | player/menu/Last.fm | Z: local state; sync worker separately | .8, .20 |
| `favorites_remove` | player/menu/Last.fm | Z | .8, .20 |
| `favorites_get_top25` | library section/API | Z | .5, .8 |
| `favorites_get_recently_played` | library/agent/API | Z | .5, .8, .11 |
| `favorites_get_recently_added` | library section/API | Z | .5, .8 |
| `lastfm_get_settings` | settings API | Z: safe projection, not secrets | .7, .20 |
| `lastfm_update_settings` | settings API | Z | .7, .20 |
| `lastfm_get_auth_url` | settings auth UI | Z/R: HTTPS/credentials primitive | .20 |
| `lastfm_auth_callback` | settings auth UI | Z/R | .20 |
| `lastfm_disconnect` | settings | Z | .20 |
| `lastfm_now_playing` | player/session | Z/R: session worker, no frontend scheduler | .20, 329 |
| `lastfm_scrobble` | session/API | Z/R: eligibility separate from submission | .20, 329 |
| `lastfm_queue_status` | settings | Z | .12, .20 |
| `lastfm_queue_retry` | settings/startup retry job | Z/R | .20 |
| `lastfm_import_loved_tracks` | settings | Z/R | .8, .20 |
| `lastfm_cache_loved_tracks` | settings | Z/R | .8, .20 |
| `lastfm_match_loved_tracks` | settings/background/scan | Z | .8, .20 |
| `lastfm_loved_stats` | settings | Z | .8, .20 |
| `lastfm_reset_loved_cache` | settings | Z | .8, .20 |
| `lyrics_get` | Now Playing/API | Z/R | .12, .23 |
| `lyrics_clear_cache` | settings/API | Z | .12, .23 |
| `settings_get_all` | service/bootstrap | Z: includes settings.json migration | .7 |
| `settings_get` | service/preferences | Z | .7 |
| `settings_set` | service/preferences | Z | .7 |
| `settings_update` | service/preferences | Z | .7 |
| `settings_reset` | settings | Z | .7 |
| `stats_get_overview` | dashboard | Z | .11 |
| `stats_get_top_artists` | dashboard/agent | Z | .11 |
| `stats_get_genres` | dashboard | Z | .11 |
| `stats_get_plays_over_time` | dashboard | Z | .11 |
| `stats_generate_chart_grid` | dashboard/export | Z/R: explicit composition to renderer | .24 |
| `network_cache_status` | settings | Z | .19 |
| `network_cache_purge` | settings | Z: cache-owned paths only | .19 |
| `plex_config_set` | settings | Z | .21 |
| `plex_config_get` | settings | Z: safe projection | .21 |
| `plex_config_clear` | settings | Z | .21 |
| `plex_server_ping` | settings/source availability | Z/R | .21 |
| `plex_list_libraries` | settings library picker | Z/R | .21 |
| `plex_fetch_albums` | catalog API/internal sync | Z/R | .21 |
| `plex_fetch_tracks` | catalog API/internal sync | Z/R | .21 |
| `plex_refresh_cache` | catalog API/internal sync | Z: catalog cache, not renderer cache | .21 |
| `plex_merge_library` | catalog API/internal sync | Z | .21 |
| `plex_sync` | settings/startup | Z/R | .21 |
| `plex_set_libraries` | settings | Z | .21 |
| `plex_libraries_current` | settings/library UI | Z | .21 |
| `plex_download_track` | queue prefetch/menu/player | Z/R: no Rust playback-source authority | .22 |
| `agent_generate_playlist` | Genius API | Z/R: provider proposals only in Rust | .25 |
| `agent_check_status` | Genius API | Z/R: optional availability | .25 |
| `agent_check_ollama` | onboarding | Z/R | .25 |
| `agent_pull_model` | onboarding | Z/R: bounded provider/HTTP execution | .25 |
| `agent_get_onboarding_state` | Genius | Z: agent.json state transfers | .7, .25 |
| `agent_set_onboarding_complete` | Genius | Z | .7, .25 |

Unregistered internal entry points (`do_plex_sync`, loved-track matching,
audio-thread scrobble helpers, agent tools and scanner/watch jobs) are not
omitted: see the [job sequence](zig-first-migration.md) and
[direct caller inventory](zig-first-storage.md). The handler list is the
registration authority, not a count of all public Rust functions.
