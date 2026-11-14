//! Desktop access to the shared database implementation.

pub(crate) use mt_core::db::*;

// Keep the Zig fixture generator and its existing test filter in the desktop
// crate; it writes repository fixtures for the sidecar parity harness.
#[cfg(test)]
#[path = "db_fixture_gen.rs"]
pub(crate) mod fixture_gen;
