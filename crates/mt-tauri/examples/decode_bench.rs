// Decode-only CPU cost of a release profile (TASK-369.4).
//
// The build-time matrix cannot answer the question that actually gates a profile
// change: fat LTO is slow to link because it can inline across crates, and the
// thing it buys is runtime speed on the decode hot path. A 44% faster cold build
// is a bad trade for a regression a listener can hear, so the decode loop is
// measured per candidate rather than assumed.
//
// It deliberately does NOT open an output device. Playback is bounded by CoreAudio
// and by the wall clock, so a played track measures neither the decoder nor the
// profile; it also fails wholesale on a host whose audio daemon is wedged. Here the
// samples are drained and reduced to a checksum the optimiser cannot elide.
//
//   cargo build --release -p mt-tauri --example decode_bench
//   decode_bench --reps 5 --json <file>...
//
// The unit is CPU seconds, not wall seconds: the point is the work the machine does,
// which is what a profile changes. Wall time is reported alongside so a candidate
// that spends CPU somewhere else is visible. The decode loop is single-threaded, so
// the two should track each other; `rayon` is not involved in this path.

use libc::{RUSAGE_SELF, getrusage, rusage};
use rodio::{Decoder, Source};
use std::fs::File;
use std::hint::black_box;
use std::time::{Duration, Instant};

/// CPU seconds the process has used, user + system, via getrusage(2).
///
/// `clock_gettime(CLOCK_PROCESS_CPUTIME_ID)` is unavailable on macOS, so the
/// rusage counters are the portable way to get process CPU here. They cover the
/// whole process, which is fine: this binary decodes and nothing else.
fn cpu_time() -> f64 {
    let mut usage: rusage = unsafe { std::mem::zeroed() };
    let ok = unsafe { getrusage(RUSAGE_SELF, &mut usage) };
    if ok != 0 {
        return 0.0;
    }
    let user = usage.ru_utime.tv_sec as f64 + usage.ru_utime.tv_usec as f64 / 1e6;
    let sys = usage.ru_stime.tv_sec as f64 + usage.ru_stime.tv_usec as f64 / 1e6;
    user + sys
}

struct Outcome {
    path: String,
    bytes: u64,
    samples: u64,
    channels: u16,
    sample_rate: u32,
    audio_seconds: f64,
    reps: u32,
    cpu_seconds: f64,
    wall_seconds: f64,
}

impl Outcome {
    /// CPU seconds to decode one copy of the file.
    fn cpu_per_decode(&self) -> f64 {
        self.cpu_seconds / f64::from(self.reps)
    }

    /// MiB of source file decoded per CPU second. The headline number: it is the
    /// same units across candidates and formats, so the summary can divide them.
    fn mib_per_cpu_second(&self) -> f64 {
        let mib = self.bytes as f64 / 1_048_576.0 * f64::from(self.reps);
        if self.cpu_seconds > 0.0 {
            mib / self.cpu_seconds
        } else {
            0.0
        }
    }

    /// How many seconds of audio one CPU second buys. Above 1.0 means the machine
    /// can decode faster than real time, which is the floor a player needs.
    fn realtime_factor(&self) -> f64 {
        let audio = self.audio_seconds * f64::from(self.reps);
        if self.cpu_seconds > 0.0 {
            audio / self.cpu_seconds
        } else {
            0.0
        }
    }
}

/// Decodes the whole file once and returns (samples, checksum).
///
/// The accumulator is consumed by `black_box` so the optimiser has to keep every
/// frame: without it, a whole-file decode whose output is discarded is dead code,
/// and a more aggressive profile would simply delete the work being measured.
fn decode_once(path: &str) -> Result<(u64, f32, u16, u32, Option<Duration>), String> {
    let file = File::open(path).map_err(|e| format!("open {path}: {e}"))?;
    let source = Decoder::try_from(file).map_err(|e| format!("decode {path}: {e}"))?;
    let channels = source.channels();
    let sample_rate = source.sample_rate();
    let duration = source.total_duration();
    let mut count: u64 = 0;
    let mut checksum: f32 = 0.0;
    for sample in source {
        checksum += sample;
        count += 1;
    }
    black_box(checksum);
    Ok((count, checksum, channels, sample_rate, duration))
}

fn bench(path: &str, reps: u32) -> Result<Outcome, String> {
    let bytes = std::fs::metadata(path)
        .map_err(|e| format!("stat {path}: {e}"))?
        .len();
    // One untimed pass: pays the first-touch page faults and any lazy decoder
    // setup so the measured loop measures decode, not cold I/O.
    let (samples, _, channels, sample_rate, duration) = decode_once(path)?;
    let audio_seconds = duration
        .map(|d| d.as_secs_f64())
        // Some containers report no duration; derive it from the frames actually
        // decoded so the real-time factor still means something.
        .unwrap_or_else(|| {
            samples as f64 / f64::from(channels.max(1)) / f64::from(sample_rate.max(1))
        });

    let cpu0 = cpu_time();
    let wall0 = Instant::now();
    for _ in 0..reps {
        let (n, sum, _, _, _) = decode_once(path)?;
        black_box(n);
        black_box(sum);
    }
    Ok(Outcome {
        path: path.to_string(),
        bytes,
        samples,
        channels,
        sample_rate,
        audio_seconds,
        reps,
        cpu_seconds: cpu_time() - cpu0,
        wall_seconds: wall0.elapsed().as_secs_f64(),
    })
}

fn parse_args() -> (Vec<String>, u32, bool) {
    let mut files = Vec::new();
    let mut reps = 5u32;
    let mut json = false;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--reps" => {
                reps = args
                    .next()
                    .and_then(|v| v.parse().ok())
                    .filter(|n: &u32| *n > 0)
                    .unwrap_or_else(|| {
                        eprintln!("--reps needs a positive number");
                        std::process::exit(2);
                    });
            }
            "--json" => json = true,
            other => files.push(other.to_string()),
        }
    }
    if files.is_empty() {
        eprintln!("usage: decode_bench [--reps N] [--json] <file>...");
        std::process::exit(2);
    }
    (files, reps, json)
}

fn main() {
    let (files, reps, json) = parse_args();
    let mut outcomes = Vec::new();
    let mut failures = 0;
    for path in &files {
        match bench(path, reps) {
            Ok(o) => outcomes.push(o),
            Err(e) => {
                eprintln!("skip: {e}");
                failures += 1;
            }
        }
    }
    if outcomes.is_empty() {
        eprintln!("decode_bench: nothing could be decoded");
        std::process::exit(1);
    }

    let cpu: f64 = outcomes.iter().map(|o| o.cpu_seconds).sum();
    let mib: f64 = outcomes
        .iter()
        .map(|o| o.bytes as f64 * f64::from(o.reps))
        .sum::<f64>()
        / 1_048_576.0;

    if json {
        let rows: Vec<String> = outcomes
            .iter()
            .map(|o| {
                format!(
                    "{{\"path\":{},\"bytes\":{},\"samples\":{},\"channels\":{},\"sample_rate\":{},\
                     \"audio_seconds\":{:.6},\"reps\":{},\"cpu_seconds\":{:.6},\
                     \"wall_seconds\":{:.6},\"cpu_per_decode\":{:.6},\
                     \"mib_per_cpu_second\":{:.3},\"realtime_factor\":{:.1}}}",
                    serde_json::to_string(&o.path).unwrap_or_default(),
                    o.bytes,
                    o.samples,
                    o.channels,
                    o.sample_rate,
                    o.audio_seconds,
                    o.reps,
                    o.cpu_seconds,
                    o.wall_seconds,
                    o.cpu_per_decode(),
                    o.mib_per_cpu_second(),
                    o.realtime_factor()
                )
            })
            .collect();
        println!(
            "{{\"reps\":{},\"files\":[{}],\"total_cpu_seconds\":{:.6},\"total_mib\":{:.3},\"aggregate_mib_per_cpu_second\":{:.3}}}",
            reps,
            rows.join(","),
            cpu,
            mib,
            if cpu > 0.0 { mib / cpu } else { 0.0 }
        );
        return;
    }

    println!("decode_bench: {reps} timed decode(s) per file, CPU seconds from getrusage");
    println!(
        "{:<44} {:>8} {:>9} {:>10} {:>9} {:>7}",
        "file", "MiB", "cpu s", "MiB/cpu s", "RT factor", "kHz/ch"
    );
    for o in &outcomes {
        let name = o.path.rsplit('/').next().unwrap_or(&o.path);
        println!(
            "{:<44} {:>8.2} {:>9.3} {:>10.1} {:>9.0} {:>7}",
            name,
            o.bytes as f64 / 1_048_576.0,
            o.cpu_per_decode(),
            o.mib_per_cpu_second(),
            o.realtime_factor(),
            o.sample_rate / 1000,
        );
    }
    println!(
        "{:<44} {:>8.2} {:>9.3} {:>10.1}",
        "TOTAL",
        mib,
        cpu,
        if cpu > 0.0 { mib / cpu } else { 0.0 }
    );
    if failures > 0 {
        eprintln!("{failures} file(s) skipped");
        std::process::exit(1);
    }
}
