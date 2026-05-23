use serde::{Deserialize, Serialize};

// ── Public types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlexConfig {
    pub url: String,
    pub token: String,
    pub libraries: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicSection {
    pub key: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlexAlbum {
    pub rating_key: String,
    pub title: String,
    pub artist_name: String,
    pub year: Option<u32>,
    pub track_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlexTrack {
    pub rating_key: String,
    pub title: String,
    pub artist_name: String,
    pub album_name: String,
    pub year: Option<u32>,
    pub track_number: u32,
    pub duration: u64,
    pub part_key: String,
}

// ── Internal Plex JSON DTOs ───────────────────────────────────────────────────

#[derive(Deserialize)]
pub(crate) struct SectionsRoot {
    #[serde(rename = "MediaContainer")]
    pub(crate) media_container: SectionsContainer,
}

#[derive(Deserialize)]
pub(crate) struct SectionsContainer {
    #[serde(rename = "Directory", default)]
    pub(crate) directories: Vec<DirectoryDto>,
}

#[derive(Deserialize)]
pub(crate) struct DirectoryDto {
    #[serde(rename = "type")]
    pub(crate) dir_type: String,
    pub(crate) key: String,
    pub(crate) title: String,
}

#[derive(Deserialize)]
pub(crate) struct AlbumsRoot {
    #[serde(rename = "MediaContainer")]
    pub(crate) media_container: AlbumsContainer,
}

#[derive(Deserialize)]
pub(crate) struct AlbumsContainer {
    #[serde(rename = "totalSize", default)]
    pub(crate) total_size: u32,
    #[serde(rename = "Metadata", default)]
    pub(crate) metadata: Vec<AlbumDto>,
}

#[derive(Deserialize)]
pub(crate) struct AlbumDto {
    #[serde(rename = "ratingKey")]
    pub(crate) rating_key: String,
    pub(crate) title: String,
    #[serde(rename = "parentTitle", default)]
    pub(crate) parent_title: String,
    pub(crate) year: Option<u32>,
    #[serde(rename = "leafCount", default)]
    pub(crate) leaf_count: u32,
}

#[derive(Deserialize)]
pub(crate) struct TracksRoot {
    #[serde(rename = "MediaContainer")]
    pub(crate) media_container: TracksContainer,
}

#[derive(Deserialize)]
pub(crate) struct TracksContainer {
    #[serde(rename = "Metadata", default)]
    pub(crate) metadata: Vec<TrackDto>,
}

#[derive(Deserialize)]
pub(crate) struct TrackDto {
    #[serde(rename = "ratingKey")]
    pub(crate) rating_key: String,
    pub(crate) title: String,
    #[serde(rename = "grandparentTitle", default)]
    pub(crate) grandparent_title: String,
    #[serde(rename = "parentTitle", default)]
    pub(crate) parent_title: String,
    pub(crate) year: Option<u32>,
    pub(crate) index: Option<u32>,
    pub(crate) duration: Option<u64>,
    #[serde(rename = "Media", default)]
    pub(crate) media: Vec<MediaDto>,
}

#[derive(Deserialize)]
pub(crate) struct MediaDto {
    #[serde(rename = "Part", default)]
    pub(crate) part: Vec<PartDto>,
}

#[derive(Deserialize)]
pub(crate) struct PartDto {
    pub(crate) key: String,
}
