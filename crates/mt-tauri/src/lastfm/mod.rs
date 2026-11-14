mod config;

#[cfg(feature = "agent")]
pub(crate) use mt_core::lastfm::client;
pub(crate) use mt_core::lastfm::{LastFmClient, types::*};

/// Construct a core client with credentials loaded by the desktop application.
pub(crate) fn new_client() -> LastFmClient {
    LastFmClient::new(config::load())
}
