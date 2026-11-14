use serde::{Deserialize, Serialize};

// ── Public types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlexConfig {
    pub url: String,
    pub token: String,
    pub libraries: Option<Vec<String>>,
    pub client_identifier: String,
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
pub struct SectionsRoot {
    #[serde(rename = "MediaContainer")]
    pub media_container: SectionsContainer,
}

#[derive(Deserialize)]
pub struct SectionsContainer {
    #[serde(rename = "Directory", default)]
    pub directories: Vec<DirectoryDto>,
}

#[derive(Deserialize)]
pub struct DirectoryDto {
    #[serde(rename = "type")]
    pub dir_type: String,
    pub key: String,
    pub title: String,
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
    #[serde(default)]
    pub(crate) title: String,
    #[serde(rename = "parentTitle", default)]
    pub(crate) parent_title: Option<String>,
    pub(crate) year: Option<u32>,
    #[serde(rename = "leafCount")]
    pub(crate) leaf_count: Option<u32>,
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

// ── Identity endpoint DTOs ────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct IdentityRoot {
    #[serde(rename = "MediaContainer")]
    pub media_container: IdentityContainer,
}

#[derive(Deserialize)]
pub struct IdentityContainer {
    #[serde(rename = "machineIdentifier", default)]
    pub machine_identifier: String,
    #[serde(rename = "friendlyName", default)]
    pub friendly_name: String,
    #[serde(rename = "version", default)]
    pub version: String,
}
