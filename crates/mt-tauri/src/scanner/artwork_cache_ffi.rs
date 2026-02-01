//! FFI wrapper for Zig artwork cache.
//!
//! Provides a safe Rust interface around the Zig artwork cache FFI.
//! This cache handles folder-based artwork (cover.jpg, folder.jpg, etc.).
//! Embedded artwork extraction remains in Rust via lofty.

use mt_core::ffi::{
    mt_artwork_cache_clear, mt_artwork_cache_free, mt_artwork_cache_get_or_load,
    mt_artwork_cache_invalidate, mt_artwork_cache_len, mt_artwork_cache_new,
    mt_artwork_cache_new_with_capacity, ArtworkCacheHandle, FfiArtwork,
};
use std::ffi::CString;

use super::artwork::{get_embedded_artwork, Artwork};

/// Thread-safe artwork cache backed by Zig implementation.
///
/// This cache provides LRU caching for artwork with a configurable capacity.
/// It combines Zig's folder-based artwork detection with Rust's embedded
/// artwork extraction via lofty.
pub struct ZigArtworkCache {
    handle: ArtworkCacheHandle,
}

// SAFETY: The Zig implementation uses internal mutex for thread safety
unsafe impl Send for ZigArtworkCache {}
unsafe impl Sync for ZigArtworkCache {}

impl ZigArtworkCache {
    /// Create a new artwork cache with default capacity (100 entries).
    ///
    /// Returns `None` if allocation fails.
    pub fn new() -> Option<Self> {
        let handle = unsafe { mt_artwork_cache_new() };
        if handle.is_null() {
            None
        } else {
            Some(Self { handle })
        }
    }

    /// Create a new artwork cache with custom capacity.
    ///
    /// Returns `None` if allocation fails.
    pub fn with_capacity(capacity: usize) -> Option<Self> {
        let handle = unsafe { mt_artwork_cache_new_with_capacity(capacity) };
        if handle.is_null() {
            None
        } else {
            Some(Self { handle })
        }
    }

    /// Get artwork for a track, using cache if available.
    ///
    /// This method:
    /// 1. Checks the Zig cache for folder-based artwork
    /// 2. Falls back to Rust's embedded artwork extraction if needed
    ///
    /// Both the folder artwork (from Zig) and embedded artwork (from Rust)
    /// results are cached.
    pub fn get_or_load(&self, track_id: i64, filepath: &str) -> Option<Artwork> {
        let path_cstr = CString::new(filepath).ok()?;

        // Try to get from Zig cache (handles folder-based artwork)
        let mut ffi_artwork = unsafe { std::mem::zeroed::<FfiArtwork>() };
        let found = unsafe {
            mt_artwork_cache_get_or_load(self.handle, track_id, path_cstr.as_ptr(), &mut ffi_artwork)
        };

        if found {
            // Convert FFI artwork to Rust Artwork
            return Some(convert_ffi_artwork(&ffi_artwork));
        }

        // Zig cache miss - try embedded artwork via Rust
        // Note: Zig's extractEmbeddedArtwork returns null by design (stays in Rust via lofty)
        // So if we get here, we need to try embedded artwork
        if let Some(artwork) = get_embedded_artwork(filepath) {
            return Some(artwork);
        }

        // No artwork found
        None
    }

    /// Invalidate cache entry for a specific track.
    ///
    /// Call this when track metadata is updated.
    pub fn invalidate(&self, track_id: i64) {
        unsafe { mt_artwork_cache_invalidate(self.handle, track_id) };
    }

    /// Clear all cache entries.
    pub fn clear(&self) {
        unsafe { mt_artwork_cache_clear(self.handle) };
    }

    /// Get current number of cached items.
    pub fn len(&self) -> usize {
        unsafe { mt_artwork_cache_len(self.handle) }
    }

    /// Check if cache is empty.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl Default for ZigArtworkCache {
    fn default() -> Self {
        Self::new().expect("Failed to create artwork cache")
    }
}

impl Drop for ZigArtworkCache {
    fn drop(&mut self) {
        unsafe { mt_artwork_cache_free(self.handle) };
    }
}

/// Convert FFI artwork to Rust Artwork type.
fn convert_ffi_artwork(ffi: &FfiArtwork) -> Artwork {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

    // The data field already contains raw bytes (not base64 encoded from Zig)
    // We need to base64 encode it for the Rust Artwork type
    let data = BASE64.encode(ffi.get_data());

    Artwork {
        data,
        mime_type: ffi.get_mime_type().to_string(),
        source: ffi.get_source().to_string(),
        filename: ffi.get_filename().map(|s| s.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_creation() {
        let cache = ZigArtworkCache::new();
        assert!(cache.is_some());

        let cache = cache.unwrap();
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }

    #[test]
    fn test_cache_with_capacity() {
        let cache = ZigArtworkCache::with_capacity(50);
        assert!(cache.is_some());

        let cache = cache.unwrap();
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_cache_operations() {
        let cache = ZigArtworkCache::new().unwrap();

        // Test with nonexistent file (should cache the None result in Zig)
        let artwork = cache.get_or_load(1, "/nonexistent/path/song.mp3");
        // Artwork extraction from Zig will fail but the cache operation works
        assert!(artwork.is_none());

        // Zig still caches the miss
        // Note: The Zig cache caches None results, so len should be 1
        assert_eq!(cache.len(), 1);

        // Invalidate
        cache.invalidate(1);
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_cache_clear() {
        let cache = ZigArtworkCache::new().unwrap();

        // Add some entries (they'll be None but still cached)
        let _ = cache.get_or_load(1, "/path/song1.mp3");
        let _ = cache.get_or_load(2, "/path/song2.mp3");
        let _ = cache.get_or_load(3, "/path/song3.mp3");

        assert_eq!(cache.len(), 3);

        cache.clear();
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }
}
