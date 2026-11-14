use super::*;

#[tokio::test]
async fn supplied_credentials_sign_authenticated_requests() {
    use wiremock::matchers::{body_string, method};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let server = MockServer::start().await;
    let mut client = LastFmClient::new(ApiKeyConfig {
        api_key: Some("injected-key".to_string()),
        api_secret: Some("injected-secret".to_string()),
    });
    client.base_url = server.uri();

    let params = BTreeMap::from([
        ("api_key".to_string(), "injected-key".to_string()),
        ("method".to_string(), "test.method".to_string()),
        ("sk".to_string(), "test-session".to_string()),
    ]);
    let expected_signature = signature::sign_params(&params, "injected-secret");
    Mock::given(method("POST"))
        .and(body_string(format!(
            "api_key=injected-key&api_sig={expected_signature}&format=json&method=test.method&sk=test-session"
        )))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"ok": true})))
        .expect(1)
        .mount(&server)
        .await;

    let response = client
        .api_call("test.method", BTreeMap::new(), Some("test-session"), true)
        .await
        .unwrap();
    assert_eq!(response["ok"], true);
}

#[test]
fn test_client_creation() {
    let client = LastFmClient::new(ApiKeyConfig::default());
    // Client should be created successfully even without API keys
    assert!(!client.base_url.is_empty());
}

#[test]
fn test_is_configured() {
    let client = LastFmClient::new(ApiKeyConfig::default());
    assert!(!client.is_configured());
    let client = LastFmClient::new(ApiKeyConfig {
        api_key: Some("test-key".to_string()),
        api_secret: Some("test-secret".to_string()),
    });
    assert!(client.is_configured());
    assert_eq!(client.config.api_key(), "test-key");
    assert_eq!(client.config.api_secret(), "test-secret");
}

#[test]
fn test_parse_track_info_with_album() {
    let json: serde_json::Value = serde_json::from_str(
        r#"{
                "track": {
                    "name": "Everlong",
                    "artist": { "name": "Foo Fighters" },
                    "album": { "title": "The Colour and the Shape", "artist": "Foo Fighters" }
                }
            }"#,
    )
    .unwrap();

    let album = json
        .get("track")
        .and_then(|t| t.get("album"))
        .and_then(|a| a.get("title"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());

    assert_eq!(album, Some("The Colour and the Shape".to_string()));
}

#[test]
fn test_parse_track_info_without_album() {
    let json: serde_json::Value = serde_json::from_str(
        r#"{
                "track": {
                    "name": "Some Track",
                    "artist": { "name": "Some Artist" }
                }
            }"#,
    )
    .unwrap();

    let album = json
        .get("track")
        .and_then(|t| t.get("album"))
        .and_then(|a| a.get("title"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());

    assert_eq!(album, None);
}

#[tokio::test]
async fn test_love_track_not_configured() {
    let client = LastFmClient {
        config: ApiKeyConfig::default(),
        rate_limiter: Arc::new(RateLimiter::new()),
        http_client: reqwest::Client::new(),
        base_url: "https://ws.audioscrobbler.com/2.0/".to_string(),
    };

    let result = client.love_track("fake_key", "Artist", "Track").await;
    assert!(matches!(result, Err(LastFmError::NotConfigured)));
}

#[tokio::test]
async fn test_unlove_track_not_configured() {
    let client = LastFmClient {
        config: ApiKeyConfig::default(),
        rate_limiter: Arc::new(RateLimiter::new()),
        http_client: reqwest::Client::new(),
        base_url: "https://ws.audioscrobbler.com/2.0/".to_string(),
    };

    let result = client.unlove_track("fake_key", "Artist", "Track").await;
    assert!(matches!(result, Err(LastFmError::NotConfigured)));
}

#[cfg(feature = "agent")]
#[test]
fn test_parse_similar_tracks_response() {
    let json: serde_json::Value = serde_json::from_str(
        r#"{
                "similartracks": {
                    "track": [
                        {"name": "Track A", "artist": {"name": "Artist A"}, "match": "0.95"},
                        {"name": "Track B", "artist": {"name": "Artist B"}, "match": "0.80"}
                    ]
                }
            }"#,
    )
    .unwrap();

    let parsed: SimilarTracksResponse = serde_json::from_value(json).unwrap();
    assert_eq!(parsed.similartracks.track.len(), 2);
    assert_eq!(parsed.similartracks.track[0].name, "Track A");
    assert_eq!(parsed.similartracks.track[0].artist.name(), "Artist A");
    assert_eq!(
        parsed.similartracks.track[0].match_score.as_deref(),
        Some("0.95")
    );
}

#[cfg(feature = "agent")]
#[test]
fn test_parse_similar_artists_response() {
    let json: serde_json::Value = serde_json::from_str(
        r#"{
                "similarartists": {
                    "artist": [
                        {"name": "Artist X", "match": "0.90"},
                        {"name": "Artist Y", "match": "0.75"}
                    ]
                }
            }"#,
    )
    .unwrap();

    let parsed: SimilarArtistsResponse = serde_json::from_value(json).unwrap();
    assert_eq!(parsed.similarartists.artist.len(), 2);
    assert_eq!(parsed.similarartists.artist[0].name, "Artist X");
}

#[cfg(feature = "agent")]
#[test]
fn test_parse_top_tags_response() {
    let json: serde_json::Value = serde_json::from_str(
        r#"{
                "toptags": {
                    "tag": [
                        {"name": "rock", "count": 100},
                        {"name": "alternative", "count": 80}
                    ]
                }
            }"#,
    )
    .unwrap();

    let parsed: TopTagsResponse = serde_json::from_value(json).unwrap();
    assert_eq!(parsed.toptags.tag.len(), 2);
    assert_eq!(parsed.toptags.tag[0].name, "rock");
    assert_eq!(parsed.toptags.tag[0].count, Some(100));
}

#[cfg(feature = "agent")]
#[test]
fn test_parse_tag_top_artists_response() {
    let json: serde_json::Value = serde_json::from_str(
        r#"{
                "topartists": {
                    "artist": [
                        {"name": "Radiohead"},
                        {"name": "Muse"}
                    ]
                }
            }"#,
    )
    .unwrap();

    let parsed: TagTopArtistsResponse = serde_json::from_value(json).unwrap();
    assert_eq!(parsed.topartists.artist.len(), 2);
    assert_eq!(parsed.topartists.artist[0].name, "Radiohead");
}

#[cfg(feature = "agent")]
#[test]
fn test_parse_geo_top_tracks_response() {
    let json: serde_json::Value = serde_json::from_str(
        r#"{
                "tracks": {
                    "track": [
                        {"name": "Bohemian Rhapsody", "artist": {"name": "Queen"}},
                        {"name": "Imagine", "artist": {"name": "John Lennon"}}
                    ]
                }
            }"#,
    )
    .unwrap();

    let parsed: GeoTopTracksResponse = serde_json::from_value(json).unwrap();
    assert_eq!(parsed.tracks.track.len(), 2);
    assert_eq!(parsed.tracks.track[0].name, "Bohemian Rhapsody");
    assert_eq!(parsed.tracks.track[0].artist.name(), "Queen");
}

#[cfg(feature = "agent")]
#[test]
fn test_parse_similar_tracks_empty() {
    let json: serde_json::Value =
        serde_json::from_str(r#"{"similartracks": {"track": []}}"#).unwrap();

    let parsed: SimilarTracksResponse = serde_json::from_value(json).unwrap();
    assert!(parsed.similartracks.track.is_empty());
}
