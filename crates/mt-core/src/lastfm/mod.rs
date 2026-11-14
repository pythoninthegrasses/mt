//! Last.fm client and data types, independent of desktop credential loading.

pub mod client;
pub mod config;
mod rate_limiter;
mod signature;
pub mod types;

pub use client::LastFmClient;
pub use config::ApiKeyConfig;
pub use types::*;
