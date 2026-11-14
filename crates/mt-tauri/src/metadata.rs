//! Desktop metadata command adapters.
//!
//! Tag reading and writing live in `mt-core`; only the IPC surface lives here.

pub(crate) use mt_core::metadata::{MetadataUpdate, TrackMetadata};

#[tracing::instrument]
#[tauri::command]
pub(crate) fn get_track_metadata(path: String) -> Result<TrackMetadata, String> {
    mt_core::metadata::get_track_metadata(path)
}

#[tauri::command]
pub(crate) fn get_tracks_metadata_batch(paths: Vec<String>) -> Result<Vec<TrackMetadata>, String> {
    mt_core::metadata::get_tracks_metadata_batch(paths)
}

#[tracing::instrument(skip(update))]
#[tauri::command]
pub(crate) fn save_track_metadata(update: MetadataUpdate) -> Result<TrackMetadata, String> {
    mt_core::metadata::save_track_metadata(update)
}
