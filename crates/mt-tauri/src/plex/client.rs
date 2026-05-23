use std::time::Duration;

use uuid::Uuid;

use super::types::*;

const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;
const DEFAULT_PAGE_SIZE: u32 = 300;

pub struct PlexClient {
    config: PlexConfig,
    http: reqwest::Client,
    client_id: String,
    page_size: u32,
}

impl PlexClient {
    pub fn new(config: PlexConfig) -> Self {
        let client_id = Uuid::new_v5(&Uuid::NAMESPACE_OID, config.token.as_bytes()).to_string();
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("failed to build reqwest client");
        Self {
            config,
            http,
            client_id,
            page_size: DEFAULT_PAGE_SIZE,
        }
    }

    #[cfg(test)]
    fn with_page_size(config: PlexConfig, page_size: u32) -> Self {
        let mut client = Self::new(config);
        client.page_size = page_size;
        client
    }

    // Shared GET helper: sets Plex headers, appends token + extra query params,
    // enforces 10 MB body cap, and maps HTTP errors to PlexError variants.
    async fn get_json(
        &self,
        url: &str,
        extra: &[(&str, &str)],
    ) -> Result<serde_json::Value, PlexError> {
        let mut params: Vec<(&str, &str)> = vec![("X-Plex-Token", self.config.token.as_str())];
        params.extend_from_slice(extra);

        let response = self
            .http
            .get(url)
            .header("Accept", "application/json")
            .header("X-Plex-Product", "mt")
            .header("X-Plex-Client-Identifier", &self.client_id)
            .query(&params)
            .send()
            .await
            .map_err(PlexError::NetworkError)?;

        let status = response.status().as_u16();
        if status == 401 {
            return Err(PlexError::Unauthorized);
        }
        if !(200..300).contains(&status) {
            return Err(PlexError::HttpStatus(status));
        }

        let bytes = response.bytes().await.map_err(PlexError::NetworkError)?;
        if bytes.len() > MAX_BODY_BYTES {
            return Err(PlexError::ResponseTooLarge);
        }

        serde_json::from_slice(&bytes).map_err(PlexError::ParseError)
    }

    async fn get(&self, path: &str) -> Result<serde_json::Value, PlexError> {
        let url = format!("{}{}", self.config.url, path);
        self.get_json(&url, &[]).await
    }

    pub async fn music_sections(&self) -> Result<Vec<MusicSection>, PlexError> {
        let val = self.get("/library/sections").await?;
        let root: SectionsRoot = serde_json::from_value(val).map_err(PlexError::ParseError)?;

        let libs = &self.config.libraries;
        let sections = root
            .media_container
            .directories
            .into_iter()
            .filter(|d| d.dir_type == "artist")
            .filter(|d| match libs {
                Some(names) => names
                    .iter()
                    .any(|n| n.to_lowercase() == d.title.to_lowercase()),
                None => true,
            })
            .map(|d| MusicSection {
                key: d.key,
                title: d.title,
            })
            .collect();

        Ok(sections)
    }

    pub async fn albums(&self, section_key: &str) -> Result<Vec<PlexAlbum>, PlexError> {
        let mut all: Vec<PlexAlbum> = Vec::new();
        let mut start = 0u32;

        loop {
            let url = format!("{}/library/sections/{}/all", self.config.url, section_key);
            let start_s = start.to_string();
            let size_s = self.page_size.to_string();

            let val = self
                .get_json(
                    &url,
                    &[
                        ("type", "9"),
                        ("X-Plex-Container-Start", &start_s),
                        ("X-Plex-Container-Size", &size_s),
                    ],
                )
                .await?;

            let root: AlbumsRoot = serde_json::from_value(val).map_err(PlexError::ParseError)?;
            let total = root.media_container.total_size;

            let page: Vec<PlexAlbum> = root
                .media_container
                .metadata
                .into_iter()
                .map(|m| PlexAlbum {
                    rating_key: m.rating_key,
                    title: m.title,
                    artist_name: m.parent_title,
                    year: m.year,
                    track_count: m.leaf_count,
                })
                .collect();

            let fetched = page.len() as u32;
            all.extend(page);
            start += fetched;

            if fetched == 0 || start >= total {
                break;
            }
        }

        Ok(all)
    }

    pub async fn tracks(&self, album_rating_key: &str) -> Result<Vec<PlexTrack>, PlexError> {
        let val = self
            .get(&format!("/library/metadata/{}/children", album_rating_key))
            .await?;
        let root: TracksRoot = serde_json::from_value(val).map_err(PlexError::ParseError)?;

        let tracks = root
            .media_container
            .metadata
            .into_iter()
            .filter_map(|m| {
                let part_key = m.media.into_iter().next()?.part.into_iter().next()?.key;
                Some(PlexTrack {
                    rating_key: m.rating_key,
                    title: m.title,
                    artist_name: m.grandparent_title,
                    album_name: m.parent_title,
                    year: m.year,
                    track_number: m.index.unwrap_or(0),
                    duration: m.duration.unwrap_or(0),
                    part_key,
                })
            })
            .collect();

        Ok(tracks)
    }

    pub fn stream_url(&self, part_key: &str) -> String {
        format!(
            "{}{}?X-Plex-Token={}",
            self.config.url, part_key, self.config.token
        )
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PlexError {
    #[error("network error: {0}")]
    NetworkError(reqwest::Error),
    #[error("HTTP error {0}")]
    HttpStatus(u16),
    #[error("unauthorized")]
    Unauthorized,
    #[error("response too large")]
    ResponseTooLarge,
    #[error("parse error: {0}")]
    ParseError(serde_json::Error),
}

#[cfg(test)]
mod tests {
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    const SECTIONS: &str = include_str!("../../tests/fixtures/plex/sections.json");
    const ALBUMS_SINGLE: &str = include_str!("../../tests/fixtures/plex/albums_single.json");
    const ALBUMS_PAGE1: &str = include_str!("../../tests/fixtures/plex/albums_page1.json");
    const ALBUMS_PAGE2: &str = include_str!("../../tests/fixtures/plex/albums_page2.json");
    const TRACKS: &str = include_str!("../../tests/fixtures/plex/tracks.json");

    fn config(url: &str) -> PlexConfig {
        PlexConfig {
            url: url.to_string(),
            token: "test-token".to_string(),
            libraries: None,
        }
    }

    // ── stream_url pure unit tests ────────────────────────────────────────────

    #[test]
    fn stream_url_http() {
        let cfg = PlexConfig {
            url: "http://192.168.1.10:32400".to_string(),
            token: "mytoken".to_string(),
            libraries: None,
        };
        let client = PlexClient::new(cfg);
        let url = client.stream_url("/library/parts/1/999/file.flac");
        assert_eq!(
            url,
            "http://192.168.1.10:32400/library/parts/1/999/file.flac?X-Plex-Token=mytoken"
        );
    }

    #[test]
    fn stream_url_https() {
        let cfg = PlexConfig {
            url: "https://plex.example.com:32400".to_string(),
            token: "securetoken".to_string(),
            libraries: None,
        };
        let client = PlexClient::new(cfg);
        let url = client.stream_url("/library/parts/2/888/file.mp3");
        assert_eq!(
            url,
            "https://plex.example.com:32400/library/parts/2/888/file.mp3?X-Plex-Token=securetoken"
        );
    }

    // ── wiremock-backed integration tests ─────────────────────────────────────

    #[tokio::test]
    async fn section_enumeration() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/library/sections"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(SECTIONS)
                    .insert_header("Content-Type", "application/json"),
            )
            .mount(&server)
            .await;

        let client = PlexClient::new(config(&server.uri()));
        let sections = client.music_sections().await.unwrap();

        // Only artist-type sections returned; photo section filtered out
        assert_eq!(sections.len(), 2);
        assert!(sections.iter().any(|s| s.title == "Music" && s.key == "1"));
        assert!(
            sections
                .iter()
                .any(|s| s.title == "Classical" && s.key == "3")
        );
    }

    #[tokio::test]
    async fn section_enumeration_library_filter() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/library/sections"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(SECTIONS)
                    .insert_header("Content-Type", "application/json"),
            )
            .mount(&server)
            .await;

        let mut cfg = config(&server.uri());
        cfg.libraries = Some(vec!["classical".to_string()]); // case-insensitive
        let client = PlexClient::new(cfg);
        let sections = client.music_sections().await.unwrap();

        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].title, "Classical");
    }

    #[tokio::test]
    async fn single_page_album_list() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/library/sections/1/all"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(ALBUMS_SINGLE)
                    .insert_header("Content-Type", "application/json"),
            )
            .mount(&server)
            .await;

        let client = PlexClient::new(config(&server.uri()));
        let albums = client.albums("1").await.unwrap();

        assert_eq!(albums.len(), 2);
        assert_eq!(albums[0].rating_key, "100");
        assert_eq!(albums[0].title, "Abbey Road");
        assert_eq!(albums[0].artist_name, "The Beatles");
        assert_eq!(albums[0].year, Some(1969));
        assert_eq!(albums[0].track_count, 17);
    }

    #[tokio::test]
    async fn multi_page_pagination() {
        let server = MockServer::start().await;

        // First page: X-Plex-Container-Start=0
        Mock::given(method("GET"))
            .and(path("/library/sections/1/all"))
            .and(query_param("X-Plex-Container-Start", "0"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(ALBUMS_PAGE1)
                    .insert_header("Content-Type", "application/json"),
            )
            .mount(&server)
            .await;

        // Second page: X-Plex-Container-Start=2 (page_size=2)
        Mock::given(method("GET"))
            .and(path("/library/sections/1/all"))
            .and(query_param("X-Plex-Container-Start", "2"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(ALBUMS_PAGE2)
                    .insert_header("Content-Type", "application/json"),
            )
            .mount(&server)
            .await;

        let client = PlexClient::with_page_size(config(&server.uri()), 2);
        let albums = client.albums("1").await.unwrap();

        // Both pages fetched; totalSize=4 exhausted after 2 pages of 2
        assert_eq!(albums.len(), 4);
        assert_eq!(albums[0].rating_key, "100");
        assert_eq!(albums[2].rating_key, "102");
        assert_eq!(albums[3].rating_key, "103");
    }

    #[tokio::test]
    async fn track_deserialization_with_nested_media_part() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/library/metadata/100/children"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_string(TRACKS)
                    .insert_header("Content-Type", "application/json"),
            )
            .mount(&server)
            .await;

        let client = PlexClient::new(config(&server.uri()));
        let tracks = client.tracks("100").await.unwrap();

        // Track with empty Media[] (ratingKey=201) filtered out
        assert_eq!(tracks.len(), 2);

        let t0 = &tracks[0];
        assert_eq!(t0.rating_key, "200");
        assert_eq!(t0.title, "Come Together");
        assert_eq!(t0.artist_name, "The Beatles");
        assert_eq!(t0.album_name, "Abbey Road");
        assert_eq!(t0.year, Some(1969));
        assert_eq!(t0.track_number, 1);
        assert_eq!(t0.duration, 259000);
        assert_eq!(t0.part_key, "/library/parts/200/1234/file.flac");

        let t1 = &tracks[1];
        assert_eq!(t1.rating_key, "202");
        assert_eq!(t1.part_key, "/library/parts/202/5678/file.mp3");
    }

    #[tokio::test]
    async fn unauthorized_maps_to_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/library/sections"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;

        let client = PlexClient::new(config(&server.uri()));
        let err = client.music_sections().await.unwrap_err();
        assert!(matches!(err, PlexError::Unauthorized));
    }

    #[tokio::test]
    async fn body_size_cap_response_too_large() {
        let server = MockServer::start().await;
        // Body of exactly 10 MB + 1 byte triggers the cap
        let oversized = vec![b'x'; MAX_BODY_BYTES + 1];
        Mock::given(method("GET"))
            .and(path("/library/sections"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_bytes(oversized)
                    .insert_header("Content-Type", "application/json"),
            )
            .mount(&server)
            .await;

        let client = PlexClient::new(config(&server.uri()));
        let err = client.music_sections().await.unwrap_err();
        assert!(matches!(err, PlexError::ResponseTooLarge));
    }
}
