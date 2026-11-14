//! Desktop scanner adapters and artwork support.
//!
//! Pure scanning logic and its tests live in `mt-core`.

pub(crate) mod artwork;
pub(crate) mod artwork_cache;
pub(crate) mod commands;

pub(crate) use mt_core::scanner::*;
