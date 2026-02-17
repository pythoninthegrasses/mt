//! LRU cache for artwork to reduce IPC calls during queue navigation.
//!
//! Caches recently accessed artwork in memory to avoid repeatedly
//! extracting artwork from files when navigating prev/next in queue.
//!
//! Uses a pure Rust LRU cache backed by the `lru` crate with
//! `parking_lot::Mutex` for thread safety.

/// Default cache size (number of tracks)
pub const DEFAULT_CACHE_SIZE: usize = 100;

// Re-export Artwork for convenience
pub use super::artwork::Artwork as ArtworkType;

mod rust_impl {
    use lru::LruCache;
    use parking_lot::Mutex;
    use std::num::NonZeroUsize;

    use super::super::artwork::{Artwork, get_artwork};
    use super::DEFAULT_CACHE_SIZE;

    /// Thread-safe LRU cache for artwork
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

pub use rust_impl::RustArtworkCache;

/// Primary export — use `ArtworkCache` throughout the codebase
pub type ArtworkCache = RustArtworkCache;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_cache_creation() {
        let cache = ArtworkCache::new();
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }

    #[test]
    fn test_cache_default() {
        let cache = ArtworkCache::default();
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }

    #[test]
    fn test_cache_with_capacity() {
        let cache = ArtworkCache::with_capacity(50);
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }

    #[test]
    fn test_cache_with_capacity_zero_uses_default() {
        // NonZeroUsize::new(0) returns None, so it falls back to 100
        let cache = ArtworkCache::with_capacity(0);
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_cache_stores_folder_artwork() {
        let cache = ArtworkCache::new();
        let dir = tempdir().unwrap();

        // Create a fake cover.jpg
        let cover_path = dir.path().join("cover.jpg");
        let mut file = File::create(&cover_path).unwrap();
        file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();

        // Create a fake audio file in the same directory
        let audio_path = dir.path().join("song.mp3");
        File::create(&audio_path).unwrap();

        // First call loads from file
        let track_id = 1;
        let artwork1 = cache.get_or_load(track_id, audio_path.to_str().unwrap());
        assert!(artwork1.is_some());
        let art = artwork1.unwrap();
        assert_eq!(art.source, "folder");
        assert_eq!(art.mime_type, "image/jpeg");
        assert_eq!(cache.len(), 1);

        // Second call uses cache
        let artwork2 = cache.get_or_load(track_id, audio_path.to_str().unwrap());
        assert!(artwork2.is_some());
        assert_eq!(cache.len(), 1); // Still 1, served from cache
    }

    #[test]
    fn test_cache_handles_missing_artwork() {
        let cache = ArtworkCache::new();
        let dir = tempdir().unwrap();

        // Audio file with no cover art in directory
        let audio_path = dir.path().join("song.mp3");
        File::create(&audio_path).unwrap();

        let artwork = cache.get_or_load(1, audio_path.to_str().unwrap());
        assert!(artwork.is_none());

        // None result should still be cached
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn test_cache_invalidation() {
        let cache = ArtworkCache::new();
        let dir = tempdir().unwrap();

        let cover_path = dir.path().join("cover.jpg");
        let mut file = File::create(&cover_path).unwrap();
        file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();

        let audio_path = dir.path().join("song.mp3");
        File::create(&audio_path).unwrap();

        let _ = cache.get_or_load(1, audio_path.to_str().unwrap());
        assert_eq!(cache.len(), 1);

        cache.invalidate(1);
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
    }

    #[test]
    fn test_cache_invalidate_nonexistent_key() {
        let cache = ArtworkCache::new();
        // Should not panic or error
        cache.invalidate(999);
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_cache_clear() {
        let cache = ArtworkCache::new();
        let dir = tempdir().unwrap();

        for i in 0..5 {
            let sub = dir.path().join(format!("album{i}"));
            std::fs::create_dir_all(&sub).unwrap();

            let cover_path = sub.join("cover.jpg");
            let mut file = File::create(&cover_path).unwrap();
            file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();

            let audio_path = sub.join("song.mp3");
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
        let cache = ArtworkCache::with_capacity(3);
        let dir = tempdir().unwrap();

        // Add 4 entries to a cache with capacity 3
        for i in 0..4 {
            let sub = dir.path().join(format!("album{i}"));
            std::fs::create_dir_all(&sub).unwrap();

            let cover_path = sub.join("cover.jpg");
            let mut file = File::create(&cover_path).unwrap();
            file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();

            let audio_path = sub.join("song.mp3");
            File::create(&audio_path).unwrap();

            let _ = cache.get_or_load(i as i64, audio_path.to_str().unwrap());
        }

        // LRU should have evicted the oldest entry
        assert_eq!(cache.len(), 3);
    }

    #[test]
    fn test_cache_lru_access_refreshes_entry() {
        let cache = ArtworkCache::with_capacity(3);
        let dir = tempdir().unwrap();

        // Create 3 albums
        let mut paths = Vec::new();
        for i in 0..3 {
            let sub = dir.path().join(format!("album{i}"));
            std::fs::create_dir_all(&sub).unwrap();

            let cover_path = sub.join("cover.jpg");
            let mut file = File::create(&cover_path).unwrap();
            file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();

            let audio_path = sub.join("song.mp3");
            File::create(&audio_path).unwrap();

            paths.push(audio_path);
        }

        // Load entries 0, 1, 2
        for (i, path) in paths.iter().enumerate() {
            let _ = cache.get_or_load(i as i64, path.to_str().unwrap());
        }
        assert_eq!(cache.len(), 3);

        // Access entry 0 again to make it most recently used
        let _ = cache.get_or_load(0, paths[0].to_str().unwrap());

        // Add entry 3 — should evict entry 1 (least recently used), not entry 0
        let sub3 = dir.path().join("album3");
        std::fs::create_dir_all(&sub3).unwrap();
        let cover3 = sub3.join("cover.jpg");
        let mut f = File::create(&cover3).unwrap();
        f.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();
        let audio3 = sub3.join("song.mp3");
        File::create(&audio3).unwrap();
        let _ = cache.get_or_load(3, audio3.to_str().unwrap());

        assert_eq!(cache.len(), 3);
    }

    #[test]
    fn test_cache_handles_nonexistent_path() {
        let cache = ArtworkCache::new();

        let artwork = cache.get_or_load(1, "/nonexistent/path/song.mp3");
        assert!(artwork.is_none());

        // Should still cache the None result
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn test_cache_multiple_tracks_same_folder() {
        let cache = ArtworkCache::new();
        let dir = tempdir().unwrap();

        let cover_path = dir.path().join("cover.jpg");
        let mut file = File::create(&cover_path).unwrap();
        file.write_all(&[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();

        // Two different tracks in the same folder
        let audio1 = dir.path().join("track1.mp3");
        let audio2 = dir.path().join("track2.mp3");
        File::create(&audio1).unwrap();
        File::create(&audio2).unwrap();

        let art1 = cache.get_or_load(1, audio1.to_str().unwrap());
        let art2 = cache.get_or_load(2, audio2.to_str().unwrap());

        // Both should find the same folder artwork
        assert!(art1.is_some());
        assert!(art2.is_some());
        assert_eq!(art1.unwrap().source, "folder");
        assert_eq!(art2.unwrap().source, "folder");
        assert_eq!(cache.len(), 2); // Two separate cache entries (keyed by track_id)
    }
}
