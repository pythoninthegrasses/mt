mod audio;
mod favorites;
mod lastfm;
mod lyrics;
mod playlists;
mod plex;
mod queue;
mod settings;
mod stats;

pub(crate) use audio::{
    AudioState, audio_get_status, audio_get_volume, audio_list_devices, audio_load,
    audio_load_and_play, audio_pause, audio_play, audio_seek, audio_set_device, audio_set_volume,
    audio_stop, network_cache_purge, network_cache_status,
};

pub(crate) use favorites::{
    favorites_add, favorites_check, favorites_get, favorites_get_recently_added,
    favorites_get_recently_played, favorites_get_top25, favorites_remove,
};

pub(crate) use lastfm::{
    lastfm_auth_callback, lastfm_cache_loved_tracks, lastfm_disconnect, lastfm_get_auth_url,
    lastfm_get_settings, lastfm_import_loved_tracks, lastfm_loved_stats, lastfm_match_loved_tracks,
    lastfm_now_playing, lastfm_queue_retry, lastfm_queue_status, lastfm_reset_loved_cache,
    lastfm_scrobble, lastfm_update_settings, match_loved_tracks_impl,
    match_new_tracks_against_loved,
};

pub(crate) use playlists::{
    playlist_add_tracks, playlist_create, playlist_delete, playlist_generate_name, playlist_get,
    playlist_list, playlist_remove_track, playlist_reorder_tracks, playlist_update,
    playlists_reorder,
};

pub(crate) use queue::{
    queue_add, queue_add_files, queue_add_play_next, queue_check_integrity, queue_clear, queue_get,
    queue_get_playback_state, queue_play_context, queue_play_context_query, queue_play_next_track,
    queue_play_previous_track, queue_remove, queue_reorder, queue_set_current_index,
    queue_set_loop, queue_set_shuffle, queue_shuffle, queue_skip_next, queue_skip_previous,
};

pub(crate) use lyrics::{lyrics_clear_cache, lyrics_get};

pub(crate) use plex::{
    PlexState, plex_config_clear, plex_config_get, plex_config_set, plex_download_track,
    plex_fetch_albums, plex_fetch_tracks, plex_list_libraries, plex_merge_library,
    plex_refresh_cache, plex_server_ping, plex_sync,
};

pub(crate) use settings::{
    settings_get, settings_get_all, settings_reset, settings_set, settings_update,
};

pub(crate) use stats::{
    stats_generate_chart_grid, stats_get_genres, stats_get_overview, stats_get_plays_over_time,
    stats_get_top_artists,
};
