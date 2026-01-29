//! Performance benchmarks for the scanner module.
//!
//! Run with: cargo test --release scanner::benchmarks -- --nocapture --test-threads=1

#[cfg(test)]
mod tests {
    use crate::scanner::fingerprint::FileFingerprint;
    use crate::scanner::inventory::run_inventory;
    use crate::scanner::metadata::{extract_metadata_batch, extract_metadata_or_default};
    use std::collections::HashMap;
    use std::fs::File;
    use std::io::Write;
    use std::time::Instant;
    use tempfile::tempdir;

    fn create_test_audio_files(dir: &std::path::Path, count: usize) -> Vec<String> {
        let mut paths = Vec::with_capacity(count);

        for i in 0..count {
            let subdir = dir.join(format!("artist{}", i % 100)).join(format!("album{}", i % 10));
            std::fs::create_dir_all(&subdir).unwrap();

            let filename = format!("track{:04}.mp3", i);
            let filepath = subdir.join(&filename);

            // Create a minimal file
            let mut file = File::create(&filepath).unwrap();
            file.write_all(format!("fake mp3 content {}", i).as_bytes())
                .unwrap();

            paths.push(filepath.to_string_lossy().to_string());
        }

        paths
    }

    #[test]
    fn bench_inventory_phase() {
        println!("\n=== Inventory Phase (Phase 1) Benchmark ===");

        let dir = tempdir().unwrap();

        // Test with various file counts
        for file_count in [100, 500, 1000, 5000] {
            // Create test files
            let _ = create_test_audio_files(dir.path(), file_count);

            let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();

            let start = Instant::now();
            let result = run_inventory(
                &[dir.path().to_string_lossy().to_string()],
                &db_fingerprints,
                true,
                None::<fn(usize)>,
            )
            .unwrap();
            let elapsed = start.elapsed();

            let files_per_sec = file_count as f64 / elapsed.as_secs_f64();
            println!(
                "Inventory {} files: {:?} ({:.0} files/sec) - {} added",
                file_count, elapsed, files_per_sec, result.stats.added
            );

            // Clean up for next iteration
            for entry in std::fs::read_dir(dir.path()).unwrap() {
                let entry = entry.unwrap();
                if entry.path().is_dir() {
                    std::fs::remove_dir_all(entry.path()).ok();
                } else {
                    std::fs::remove_file(entry.path()).ok();
                }
            }
        }
    }

    #[test]
    fn bench_inventory_no_change() {
        println!("\n=== Inventory No-Change (Rescan) Benchmark ===");

        let dir = tempdir().unwrap();
        let file_count = 1000;

        // Create test files
        let _ = create_test_audio_files(dir.path(), file_count);

        // First scan to get fingerprints
        let empty_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();
        let first_result = run_inventory(
            &[dir.path().to_string_lossy().to_string()],
            &empty_fingerprints,
            true,
            None::<fn(usize)>,
        )
        .unwrap();

        // Build fingerprint map from first scan
        let db_fingerprints: HashMap<String, FileFingerprint> = first_result
            .added
            .into_iter()
            .collect();

        // Rescan with existing fingerprints (no changes)
        let iterations = 10;
        let start = Instant::now();
        for _ in 0..iterations {
            let _ = run_inventory(
                &[dir.path().to_string_lossy().to_string()],
                &db_fingerprints,
                true,
                None::<fn(usize)>,
            )
            .unwrap();
        }
        let elapsed = start.elapsed();

        let avg_ms = elapsed.as_secs_f64() * 1000.0 / iterations as f64;
        println!(
            "Rescan {} unchanged files: {:.2} ms avg ({} iterations)",
            file_count, avg_ms, iterations
        );
        println!("This simulates a no-op library rescan.");
    }

    #[test]
    fn bench_metadata_extraction_serial() {
        println!("\n=== Metadata Extraction (Serial) Benchmark ===");

        let dir = tempdir().unwrap();

        // Create test files
        let paths = create_test_audio_files(dir.path(), 100);
        let filepaths: Vec<(String, FileFingerprint)> = paths
            .into_iter()
            .map(|p| {
                let fp = FileFingerprint::from_path(std::path::Path::new(&p)).unwrap();
                (p, fp)
            })
            .collect();

        let iterations = 10;
        let start = Instant::now();
        for _ in 0..iterations {
            for (filepath, _) in &filepaths {
                let _ = extract_metadata_or_default(filepath);
            }
        }
        let elapsed = start.elapsed();

        let total_files = filepaths.len() * iterations;
        let files_per_sec = total_files as f64 / elapsed.as_secs_f64();
        let avg_per_file = elapsed.as_secs_f64() * 1000.0 / total_files as f64;

        println!(
            "Serial extraction ({} files x {} iterations): {:?}",
            filepaths.len(),
            iterations,
            elapsed
        );
        println!(
            "  {:.0} files/sec, {:.3} ms/file",
            files_per_sec, avg_per_file
        );
    }

    #[test]
    fn bench_metadata_extraction_parallel() {
        println!("\n=== Metadata Extraction (Parallel) Benchmark ===");

        let dir = tempdir().unwrap();

        // Test with various file counts
        for file_count in [100, 500, 1000] {
            let paths = create_test_audio_files(dir.path(), file_count);
            let filepaths: Vec<(String, FileFingerprint)> = paths
                .into_iter()
                .map(|p| {
                    let fp = FileFingerprint::from_path(std::path::Path::new(&p)).unwrap();
                    (p, fp)
                })
                .collect();

            let start = Instant::now();
            let results = extract_metadata_batch(&filepaths, None::<fn(usize, usize)>);
            let elapsed = start.elapsed();

            let files_per_sec = file_count as f64 / elapsed.as_secs_f64();
            println!(
                "Parallel extraction {} files: {:?} ({:.0} files/sec)",
                file_count, elapsed, files_per_sec
            );

            assert_eq!(results.len(), file_count);

            // Clean up for next iteration
            for entry in std::fs::read_dir(dir.path()).unwrap() {
                let entry = entry.unwrap();
                if entry.path().is_dir() {
                    std::fs::remove_dir_all(entry.path()).ok();
                } else {
                    std::fs::remove_file(entry.path()).ok();
                }
            }
        }
    }

    #[test]
    fn bench_fingerprint_comparison() {
        println!("\n=== Fingerprint Comparison Benchmark ===");

        // Create fingerprints
        let count = 100_000;
        let fingerprints: Vec<FileFingerprint> = (0..count)
            .map(|i| FileFingerprint::from_db(Some(i as i64 * 1000000), (i * 1000) as i64))
            .collect();

        let target = FileFingerprint::from_db(Some(50_000 * 1000000), 50_000 * 1000);

        let iterations = 100;
        let start = Instant::now();
        for _ in 0..iterations {
            let _ = fingerprints.iter().filter(|fp| fp.matches(&target)).count();
        }
        let elapsed = start.elapsed();

        let comparisons_per_sec = (count * iterations) as f64 / elapsed.as_secs_f64();
        println!(
            "Compared {} fingerprints x {} iterations: {:?}",
            count, iterations, elapsed
        );
        println!("  {:.0} comparisons/sec", comparisons_per_sec);
    }

    #[test]
    fn bench_full_scan_simulation() {
        println!("\n=== Full 2-Phase Scan Simulation Benchmark ===");
        println!("Note: Using fake files (no real audio), metadata extraction will be fast.");

        let dir = tempdir().unwrap();
        let file_count = 1000;

        // Create test files
        let _ = create_test_audio_files(dir.path(), file_count);

        // Simulate first scan (all files are new)
        let db_fingerprints: HashMap<String, FileFingerprint> = HashMap::new();

        let start = Instant::now();

        // Phase 1: Inventory
        let inventory_start = Instant::now();
        let inventory = run_inventory(
            &[dir.path().to_string_lossy().to_string()],
            &db_fingerprints,
            true,
            None::<fn(usize)>,
        )
        .unwrap();
        let inventory_elapsed = inventory_start.elapsed();

        // Phase 2: Metadata extraction
        let parse_start = Instant::now();
        let filepaths: Vec<(String, FileFingerprint)> = inventory.added;
        let _metadata = extract_metadata_batch(&filepaths, None::<fn(usize, usize)>);
        let parse_elapsed = parse_start.elapsed();

        let total_elapsed = start.elapsed();

        println!("Full scan of {} files:", file_count);
        println!("  Phase 1 (Inventory): {:?}", inventory_elapsed);
        println!("  Phase 2 (Parse):     {:?}", parse_elapsed);
        println!("  Total:               {:?}", total_elapsed);
        println!(
            "  Throughput:          {:.0} files/sec",
            file_count as f64 / total_elapsed.as_secs_f64()
        );
    }
}
