use lru::LruCache;
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use std::io;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use tracing::{debug, warn};

const MAX_LRU_ENTRIES: usize = 10_000;

struct CacheEntry {
    cached_path: PathBuf,
    size_bytes: u64,
}

struct CacheInner {
    index: LruCache<String, CacheEntry>,
    current_bytes: u64,
    max_bytes: u64,
}

/// Disk-based LRU cache for audio files on network mounts.
///
/// Files are copied to a local cache directory keyed by SHA-256 hash
/// of the source path. The original file extension is preserved so
/// Rodio can detect the audio format.
pub struct NetworkFileCache {
    cache_dir: PathBuf,
    inner: Mutex<CacheInner>,
}

impl NetworkFileCache {
    pub fn new(cache_dir: PathBuf, max_bytes: u64) -> io::Result<Self> {
        std::fs::create_dir_all(&cache_dir)?;

        let lru_cap = NonZeroUsize::new(MAX_LRU_ENTRIES).unwrap();
        let cache = Self {
            cache_dir,
            inner: Mutex::new(CacheInner {
                index: LruCache::new(lru_cap),
                current_bytes: 0,
                max_bytes,
            }),
        };

        cache.rebuild_index()?;
        Ok(cache)
    }

    /// Return a local cached path for the given source file.
    /// Copies the file into the cache on a miss; returns the existing
    /// cached path on a hit.
    pub fn get_or_cache(&self, source_path: &str) -> io::Result<PathBuf> {
        let key = Self::cache_key(source_path);

        // Check for cache hit
        {
            let mut inner = self.inner.lock();
            if let Some(entry) = inner.index.get(&key) {
                if entry.cached_path.exists() {
                    debug!(source = source_path, "Network cache hit");
                    return Ok(entry.cached_path.clone());
                }
                // Cached file was deleted externally; remove stale entry
                let entry = inner.index.pop(&key).unwrap();
                inner.current_bytes = inner.current_bytes.saturating_sub(entry.size_bytes);
            }
        }

        // Cache miss: copy file
        let source = Path::new(source_path);
        let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("");
        let cached_name = if ext.is_empty() {
            key.clone()
        } else {
            format!("{key}.{ext}")
        };
        let cached_path = self.cache_dir.join(&cached_name);

        let file_size = std::fs::metadata(source)?.len();

        // Evict entries until there is room
        {
            let mut inner = self.inner.lock();
            Self::evict_to_fit(&mut inner, file_size);
        }

        std::fs::copy(source, &cached_path)?;
        debug!(source = source_path, cached = %cached_path.display(), "Network cache miss; file cached");

        // Insert into index
        {
            let mut inner = self.inner.lock();
            inner.current_bytes += file_size;
            inner.index.put(
                key,
                CacheEntry {
                    cached_path: cached_path.clone(),
                    size_bytes: file_size,
                },
            );
        }

        Ok(cached_path)
    }

    /// Remove all cached files and reset the index.
    pub fn purge(&self) -> io::Result<()> {
        let mut inner = self.inner.lock();
        // Delete each cached file
        for (_key, entry) in inner.index.iter() {
            if entry.cached_path.exists()
                && let Err(e) = std::fs::remove_file(&entry.cached_path)
            {
                warn!(path = %entry.cached_path.display(), error = %e, "Failed to remove cached file");
            }
        }
        inner.index.clear();
        inner.current_bytes = 0;
        Ok(())
    }

    pub fn set_max_bytes(&self, max_bytes: u64) {
        let mut inner = self.inner.lock();
        inner.max_bytes = max_bytes;
        // Evict if current size exceeds the new limit
        Self::evict_to_fit(&mut inner, 0);
    }

    pub fn current_size_bytes(&self) -> u64 {
        self.inner.lock().current_bytes
    }

    pub fn entry_count(&self) -> usize {
        self.inner.lock().index.len()
    }

    fn cache_key(source_path: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(source_path.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    fn evict_to_fit(inner: &mut CacheInner, needed_bytes: u64) {
        while inner.current_bytes + needed_bytes > inner.max_bytes {
            match inner.index.pop_lru() {
                Some((_key, entry)) => {
                    if entry.cached_path.exists() {
                        let _ = std::fs::remove_file(&entry.cached_path);
                    }
                    inner.current_bytes = inner.current_bytes.saturating_sub(entry.size_bytes);
                }
                None => break,
            }
        }
    }

    /// Scan the cache directory and rebuild the in-memory LRU index
    /// from file modification times (oldest first = LRU).
    fn rebuild_index(&self) -> io::Result<()> {
        let mut entries: Vec<(String, PathBuf, u64, std::time::SystemTime)> = Vec::new();

        for dir_entry in std::fs::read_dir(&self.cache_dir)? {
            let dir_entry = dir_entry?;
            let path = dir_entry.path();
            if !path.is_file() {
                continue;
            }
            let meta = std::fs::metadata(&path)?;
            let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
            let size = meta.len();

            // The cache key is the file stem (hash before extension)
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            entries.push((stem, path, size, mtime));
        }

        // Sort by mtime ascending so that oldest entries are inserted first
        // (and thus become LRU candidates)
        entries.sort_by_key(|(_, _, _, mtime)| *mtime);

        let mut inner = self.inner.lock();
        inner.index.clear();
        inner.current_bytes = 0;

        for (key, path, size, _mtime) in entries {
            inner.current_bytes += size;
            inner.index.put(
                key,
                CacheEntry {
                    cached_path: path,
                    size_bytes: size,
                },
            );
        }

        debug!(
            entries = inner.index.len(),
            bytes = inner.current_bytes,
            "Network cache index rebuilt"
        );

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn create_test_file(dir: &Path, name: &str, size: usize) -> PathBuf {
        let path = dir.join(name);
        let data = vec![0xABu8; size];
        std::fs::write(&path, &data).unwrap();
        path
    }

    #[test]
    fn test_create_cache() {
        let dir = tempdir().unwrap();
        let cache_dir = dir.path().join("cache");
        let cache = NetworkFileCache::new(cache_dir.clone(), 1024 * 1024).unwrap();
        assert!(cache_dir.exists());
        assert_eq!(cache.entry_count(), 0);
        assert_eq!(cache.current_size_bytes(), 0);
    }

    #[test]
    fn test_write_and_retrieve() {
        let dir = tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(&source_dir).unwrap();

        let source = create_test_file(&source_dir, "song.flac", 1000);
        let cache = NetworkFileCache::new(cache_dir, 1024 * 1024).unwrap();

        let cached = cache.get_or_cache(source.to_str().unwrap()).unwrap();

        assert!(cached.exists());
        assert_ne!(cached, source);
        assert_eq!(std::fs::read(&cached).unwrap().len(), 1000);
        assert_eq!(cache.entry_count(), 1);
        assert_eq!(cache.current_size_bytes(), 1000);
    }

    #[test]
    fn test_cache_hit() {
        let dir = tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(&source_dir).unwrap();

        let source = create_test_file(&source_dir, "song.mp3", 500);
        let cache = NetworkFileCache::new(cache_dir, 1024 * 1024).unwrap();
        let source_str = source.to_str().unwrap();

        let first = cache.get_or_cache(source_str).unwrap();
        let second = cache.get_or_cache(source_str).unwrap();

        assert_eq!(first, second);
        assert_eq!(cache.entry_count(), 1);
    }

    #[test]
    fn test_lru_eviction_by_size() {
        let dir = tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(&source_dir).unwrap();

        // Cache can hold 1500 bytes; each file is 600 bytes
        let cache = NetworkFileCache::new(cache_dir, 1500).unwrap();

        let f1 = create_test_file(&source_dir, "a.mp3", 600);
        let f2 = create_test_file(&source_dir, "b.mp3", 600);
        let f3 = create_test_file(&source_dir, "c.mp3", 600);

        let p1 = cache.get_or_cache(f1.to_str().unwrap()).unwrap();
        let _p2 = cache.get_or_cache(f2.to_str().unwrap()).unwrap();

        assert_eq!(cache.entry_count(), 2);
        assert_eq!(cache.current_size_bytes(), 1200);

        // Adding third file should evict the first (LRU)
        let _p3 = cache.get_or_cache(f3.to_str().unwrap()).unwrap();

        assert_eq!(cache.entry_count(), 2);
        assert_eq!(cache.current_size_bytes(), 1200);
        // First file's cached copy should be deleted
        assert!(!p1.exists());
    }

    #[test]
    fn test_access_refresh() {
        let dir = tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(&source_dir).unwrap();

        let cache = NetworkFileCache::new(cache_dir, 1500).unwrap();

        let f1 = create_test_file(&source_dir, "a.mp3", 600);
        let f2 = create_test_file(&source_dir, "b.mp3", 600);
        let f3 = create_test_file(&source_dir, "c.mp3", 600);

        let _p1 = cache.get_or_cache(f1.to_str().unwrap()).unwrap();
        let p2 = cache.get_or_cache(f2.to_str().unwrap()).unwrap();

        // Access f1 again to refresh it
        let _p1_again = cache.get_or_cache(f1.to_str().unwrap()).unwrap();

        // Adding f3 should evict f2 (now LRU), not f1
        let _p3 = cache.get_or_cache(f3.to_str().unwrap()).unwrap();

        assert_eq!(cache.entry_count(), 2);
        assert!(!p2.exists());
    }

    #[test]
    fn test_purge() {
        let dir = tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(&source_dir).unwrap();

        let cache = NetworkFileCache::new(cache_dir.clone(), 1024 * 1024).unwrap();
        let f = create_test_file(&source_dir, "song.mp3", 100);

        let cached = cache.get_or_cache(f.to_str().unwrap()).unwrap();
        assert!(cached.exists());

        cache.purge().unwrap();

        assert_eq!(cache.entry_count(), 0);
        assert_eq!(cache.current_size_bytes(), 0);
        assert!(!cached.exists());
    }

    #[test]
    fn test_set_max_bytes() {
        let dir = tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(&source_dir).unwrap();

        let cache = NetworkFileCache::new(cache_dir, 2000).unwrap();

        let f1 = create_test_file(&source_dir, "a.mp3", 600);
        let f2 = create_test_file(&source_dir, "b.mp3", 600);
        let f3 = create_test_file(&source_dir, "c.mp3", 600);

        cache.get_or_cache(f1.to_str().unwrap()).unwrap();
        cache.get_or_cache(f2.to_str().unwrap()).unwrap();
        cache.get_or_cache(f3.to_str().unwrap()).unwrap();
        assert_eq!(cache.entry_count(), 3);
        assert_eq!(cache.current_size_bytes(), 1800);

        // Shrink limit to 1300 — should evict the LRU entry
        cache.set_max_bytes(1300);
        assert_eq!(cache.entry_count(), 2);
        assert_eq!(cache.current_size_bytes(), 1200);
    }

    #[test]
    fn test_extension_preservation() {
        let dir = tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(&source_dir).unwrap();

        let cache = NetworkFileCache::new(cache_dir, 1024 * 1024).unwrap();

        let f = create_test_file(&source_dir, "track.flac", 100);
        let cached = cache.get_or_cache(f.to_str().unwrap()).unwrap();

        assert_eq!(cached.extension().and_then(|e| e.to_str()), Some("flac"));
    }

    #[test]
    fn test_no_extension() {
        let dir = tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(&source_dir).unwrap();

        let cache = NetworkFileCache::new(cache_dir, 1024 * 1024).unwrap();

        let f = create_test_file(&source_dir, "noext", 100);
        let cached = cache.get_or_cache(f.to_str().unwrap()).unwrap();

        assert!(cached.extension().is_none());
    }

    #[test]
    fn test_rebuild_index() {
        let dir = tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(&source_dir).unwrap();

        // Create a cache and populate it
        let cache = NetworkFileCache::new(cache_dir.clone(), 1024 * 1024).unwrap();
        let f1 = create_test_file(&source_dir, "a.mp3", 300);
        let f2 = create_test_file(&source_dir, "b.flac", 500);
        cache.get_or_cache(f1.to_str().unwrap()).unwrap();
        cache.get_or_cache(f2.to_str().unwrap()).unwrap();
        assert_eq!(cache.entry_count(), 2);

        // Create a new cache instance from the same directory
        let cache2 = NetworkFileCache::new(cache_dir, 1024 * 1024).unwrap();
        assert_eq!(cache2.entry_count(), 2);
        assert_eq!(cache2.current_size_bytes(), 800);
    }

    #[test]
    fn test_stale_entry_recovery() {
        let dir = tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let cache_dir = dir.path().join("cache");
        std::fs::create_dir_all(&source_dir).unwrap();

        let cache = NetworkFileCache::new(cache_dir, 1024 * 1024).unwrap();
        let f = create_test_file(&source_dir, "song.mp3", 200);
        let source_str = f.to_str().unwrap();

        let cached = cache.get_or_cache(source_str).unwrap();
        assert!(cached.exists());

        // Externally delete the cached file
        std::fs::remove_file(&cached).unwrap();

        // Should detect the missing file and re-cache
        let cached2 = cache.get_or_cache(source_str).unwrap();
        assert!(cached2.exists());
    }

    #[test]
    fn test_cache_key_deterministic() {
        let k1 = NetworkFileCache::cache_key("/music/song.mp3");
        let k2 = NetworkFileCache::cache_key("/music/song.mp3");
        assert_eq!(k1, k2);
    }

    #[test]
    fn test_cache_key_different_for_different_paths() {
        let k1 = NetworkFileCache::cache_key("/music/a.mp3");
        let k2 = NetworkFileCache::cache_key("/music/b.mp3");
        assert_ne!(k1, k2);
    }
}
