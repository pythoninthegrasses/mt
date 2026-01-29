//! LRU cache for artwork to reduce IPC calls during queue navigation.
//!
//! Caches recently accessed artwork in memory to avoid repeatedly
//! extracting artwork from files when navigating prev/next in queue.
//!
//! This module delegates to the Zig implementation for LRU caching
//! and combines it with Rust's lofty-based embedded artwork extraction.

// Re-export ZigArtworkCache as ArtworkCache for backward compatibility
pub use super::artwork_cache_ffi::ZigArtworkCache as ArtworkCache;

/// Default cache size (number of tracks)
pub const DEFAULT_CACHE_SIZE: usize = 100;

// Re-export Artwork for convenience
pub use super::artwork::Artwork as ArtworkType;

// ============================================================================
// Legacy Rust implementation (preserved for reference)
// The Zig implementation is now the default.
// ============================================================================

#[cfg(feature = "rust-lru-cache")]
mod rust_impl {
    use lru::LruCache;
    use parking_lot::Mutex;
    use std::num::NonZeroUsize;

    use super::super::artwork::{get_artwork, Artwork};
    use super::DEFAULT_CACHE_SIZE;

    /// Thread-safe LRU cache for artwork (Rust implementation)
    pub struct RustArtworkCache {
        cache: Mutex<LruCache<i64, Option<Artwork>>>,
    }

    impl RustArtworkCache {
        /// Create a new artwork cache with default size
        pub fn new() -> Self {
            Self::with_capacity(DEFAULT_CACHE_SIZE)
        }

        /// Create a new artwork cache with specified capacity
        pub fn with_capacity(capacity: usize) -> Self {
            let size = NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::new(100).unwrap());
            Self {
                cache: Mutex::new(LruCache::new(size)),
            }
        }

        /// Get artwork for a track, using cache if available
        pub fn get_or_load(&self, track_id: i64, filepath: &str) -> Option<Artwork> {
            // Check cache first
            {
                let mut cache = self.cache.lock();
                if let Some(cached) = cache.get(&track_id) {
                    return cached.clone();
                }
            }

            // Not in cache, load from file
            let artwork = get_artwork(filepath);

            // Store in cache
            {
                let mut cache = self.cache.lock();
                cache.put(track_id, artwork.clone());
            }

            artwork
        }

        /// Invalidate cache entry for a specific track
        /// Called when track metadata is updated
        pub fn invalidate(&self, track_id: i64) {
            let mut cache = self.cache.lock();
            cache.pop(&track_id);
        }

        /// Clear all cache entries
        pub fn clear(&self) {
            let mut cache = self.cache.lock();
            cache.clear();
        }

        /// Get current cache size
        pub fn len(&self) -> usize {
            let cache = self.cache.lock();
            cache.len()
        }

        /// Check if cache is empty
        pub fn is_empty(&self) -> bool {
            let cache = self.cache.lock();
            cache.is_empty()
        }
    }

    impl Default for RustArtworkCache {
        fn default() -> Self {
            Self::new()
        }
    }
}

#[cfg(feature = "rust-lru-cache")]
pub use rust_impl::RustArtworkCache;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_cache_creation() {
        let cache = ArtworkCache::new();
        assert!(cache.is_some());
        let cache = cache.unwrap();
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }

    #[test]
    fn test_cache_with_capacity() {
        let cache = ArtworkCache::with_capacity(50);
        assert!(cache.is_some());
        let cache = cache.unwrap();
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_cache_stores_result() {
        let cache = ArtworkCache::new().unwrap();
        let dir = tempdir().unwrap();

        // Create a fake cover.jpg
        let cover_path = dir.path().join("cover.jpg");
        let mut file = File::create(&cover_path).unwrap();
        file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();

        // Create a fake audio file
        let audio_path = dir.path().join("song.mp3");
        File::create(&audio_path).unwrap();

        // First call should load from file
        let track_id = 1;
        let artwork1 = cache.get_or_load(track_id, audio_path.to_str().unwrap());
        assert!(artwork1.is_some());
        assert_eq!(cache.len(), 1);

        // Second call should use cache (same result)
        let artwork2 = cache.get_or_load(track_id, audio_path.to_str().unwrap());
        assert!(artwork2.is_some());
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn test_cache_invalidation() {
        let cache = ArtworkCache::new().unwrap();
        let dir = tempdir().unwrap();

        let cover_path = dir.path().join("cover.jpg");
        let mut file = File::create(&cover_path).unwrap();
        file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();

        let audio_path = dir.path().join("song.mp3");
        File::create(&audio_path).unwrap();

        let track_id = 1;
        let _ = cache.get_or_load(track_id, audio_path.to_str().unwrap());
        assert_eq!(cache.len(), 1);

        // Invalidate cache entry
        cache.invalidate(track_id);
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_cache_clear() {
        let cache = ArtworkCache::new().unwrap();
        let dir = tempdir().unwrap();

        for i in 0..5 {
            let cover_path = dir.path().join(format!("cover{i}.jpg"));
            let mut file = File::create(&cover_path).unwrap();
            file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();

            let audio_path = dir.path().join(format!("song{i}.mp3"));
            File::create(&audio_path).unwrap();

            let _ = cache.get_or_load(i, audio_path.to_str().unwrap());
        }

        assert_eq!(cache.len(), 5);

        cache.clear();
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }

    #[test]
    fn test_cache_lru_eviction() {
        let cache = ArtworkCache::with_capacity(3).unwrap();
        let dir = tempdir().unwrap();

        // Add 4 items to cache with capacity 3
        for i in 0..4 {
            let cover_path = dir.path().join(format!("cover{i}.jpg"));
            let mut file = File::create(&cover_path).unwrap();
            file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();

            let audio_path = dir.path().join(format!("song{i}.mp3"));
            File::create(&audio_path).unwrap();

            let _ = cache.get_or_load(i as i64, audio_path.to_str().unwrap());
        }

        // Cache should only hold 3 items (LRU evicted the oldest)
        assert_eq!(cache.len(), 3);
    }

    #[test]
    fn test_cache_handles_missing_artwork() {
        let cache = ArtworkCache::new().unwrap();
        let dir = tempdir().unwrap();

        // Create audio file without artwork
        let audio_path = dir.path().join("song.mp3");
        File::create(&audio_path).unwrap();

        let track_id = 1;
        let artwork = cache.get_or_load(track_id, audio_path.to_str().unwrap());
        assert!(artwork.is_none());

        // Should still cache the "None" result
        assert_eq!(cache.len(), 1);
    }
}
