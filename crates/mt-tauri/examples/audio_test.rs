use mt_lib::audio::AudioEngine;
use std::thread;
use std::time::Duration;

fn main() {
    println!("Creating audio engine...");
    let mut engine = match AudioEngine::new() {
        Ok(e) => e,
        Err(e) => {
            eprintln!("Failed to create audio engine: {}", e);
            return;
        }
    };

    let test_file = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("Usage: audio_test <path_to_audio_file>");
        std::process::exit(1);
    });

    println!("Loading: {}", test_file);
    match engine.load(&test_file) {
        Ok(info) => {
            println!("Loaded track:");
            println!("  Duration: {}ms", info.duration_ms);
            println!("  Sample rate: {}Hz", info.sample_rate);
            println!("  Channels: {}", info.channels);
        }
        Err(e) => {
            eprintln!("Failed to load: {}", e);
            return;
        }
    }

    println!("\nPlaying...");
    if let Err(e) = engine.play() {
        eprintln!("Failed to play: {}", e);
        return;
    }

    for i in 0..10 {
        thread::sleep(Duration::from_secs(1));
        let progress = engine.get_progress();
        println!(
            "[{}s] Position: {}ms / {}ms | State: {:?}",
            i + 1,
            progress.position_ms,
            progress.duration_ms,
            progress.state
        );
    }

    println!("\nPausing...");
    let _ = engine.pause();
    thread::sleep(Duration::from_secs(2));

    println!("Resuming...");
    let _ = engine.play();
    thread::sleep(Duration::from_secs(3));

    println!("\nSeeking to 30s...");
    if let Err(e) = engine.seek(30000) {
        eprintln!("Seek failed: {}", e);
    }
    thread::sleep(Duration::from_secs(3));

    let progress = engine.get_progress();
    println!(
        "After seek: {}ms / {}ms",
        progress.position_ms, progress.duration_ms
    );

    println!("\nSetting volume to 50%...");
    engine.set_volume(0.5);
    thread::sleep(Duration::from_secs(3));

    println!("\nStopping...");
    engine.stop();

    println!("Done!");
}
