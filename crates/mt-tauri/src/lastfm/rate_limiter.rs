use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use tokio::time::sleep;

/// Rate limiter for Last.fm API calls
///
/// Last.fm API limits:
/// - 5 requests per second
/// - 333 requests per 24 hours
pub struct RateLimiter {
    requests: Mutex<Vec<u64>>,
    daily_limit: usize,
    per_second_limit: usize,
}

impl RateLimiter {
    /// Create a new rate limiter with Last.fm's default limits
    pub fn new() -> Self {
        Self {
            requests: Mutex::new(Vec::new()),
            daily_limit: 333,
            per_second_limit: 5,
        }
    }

    /// Wait if needed to respect rate limits, then record the request
    pub async fn wait_if_needed(&self) {
        let mut requests = self.requests.lock().await;

        let now = Self::current_timestamp();

        // Clean old requests (keep last 24 hours)
        requests.retain(|&req_time| now - req_time < 86400);

        // Check daily limit
        if requests.len() >= self.daily_limit {
            // Wait until oldest request expires (24 hours)
            let oldest = requests[0];
            let wait_time = 86400 - (now - oldest);
            if wait_time > 0 {
                drop(requests); // Release lock before sleeping
                sleep(Duration::from_secs(wait_time)).await;
                requests = self.requests.lock().await;
            }
        }

        // Check per-second limit
        let recent_requests: Vec<u64> = requests
            .iter()
            .filter(|&&req_time| now - req_time < 1)
            .copied()
            .collect();

        if recent_requests.len() >= self.per_second_limit {
            // Wait until oldest recent request expires (1 second)
            let oldest_recent = recent_requests[0];
            let wait_time = 1 - (now - oldest_recent);
            if wait_time > 0 {
                drop(requests); // Release lock before sleeping
                sleep(Duration::from_secs(wait_time)).await;
                requests = self.requests.lock().await;
            }
        }

        // Record this request
        requests.push(now);
    }

    /// Get current Unix timestamp in seconds
    fn current_timestamp() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    /// Get the number of requests made in the last 24 hours (for testing/debugging)
    #[allow(dead_code)]
    pub async fn request_count(&self) -> usize {
        let requests = self.requests.lock().await;
        let now = Self::current_timestamp();
        requests.iter().filter(|&&req_time| now - req_time < 86400).count()
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[tokio::test]
    async fn test_rate_limiter_allows_requests() {
        let limiter = RateLimiter::new();

        // First request should not wait
        let start = Instant::now();
        limiter.wait_if_needed().await;
        let elapsed = start.elapsed();

        assert!(elapsed < Duration::from_millis(100));
    }

    #[tokio::test]
    async fn test_rate_limiter_enforces_per_second_limit() {
        let limiter = RateLimiter::new();

        // Make 5 requests (should be instant)
        for _ in 0..5 {
            limiter.wait_if_needed().await;
        }

        // 6th request should wait ~1 second
        let start = Instant::now();
        limiter.wait_if_needed().await;
        let elapsed = start.elapsed();

        // Should have waited close to 1 second
        assert!(elapsed >= Duration::from_millis(900));
        assert!(elapsed < Duration::from_millis(1200));
    }

    #[tokio::test]
    async fn test_rate_limiter_cleans_old_requests() {
        let limiter = RateLimiter::new();

        // Make some requests
        for _ in 0..3 {
            limiter.wait_if_needed().await;
        }

        let count_before = limiter.request_count().await;
        assert_eq!(count_before, 3);

        // Manually expire old requests by modifying internal state
        // (In real usage, this happens naturally after 24 hours)
        let mut requests = limiter.requests.lock().await;
        requests.clear();
        drop(requests);

        let count_after = limiter.request_count().await;
        assert_eq!(count_after, 0);
    }
}
