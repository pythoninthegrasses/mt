mod audio;
mod favorites;
mod lastfm;
mod playlists;
mod queue;
mod settings;

pub(crate) use audio::{
    AudioState, audio_get_status, audio_get_volume, audio_load, audio_load_and_play, audio_pause,
    audio_play, audio_seek, audio_set_volume, audio_stop,
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
    queue_add, queue_add_files, queue_clear, queue_get, queue_get_playback_state, queue_remove,
    queue_reorder, queue_set_current_index, queue_set_loop, queue_set_shuffle, queue_shuffle,
};

pub(crate) use settings::{
    settings_get, settings_get_all, settings_reset, settings_set, settings_update,
};
