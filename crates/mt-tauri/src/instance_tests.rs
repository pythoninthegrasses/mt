use super::*;
use std::io::{BufRead, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

#[test]
fn contention_preserves_database_and_endpoint() {
    let dir = tempfile::tempdir().unwrap();
    let database = dir.path().join("mt.db");
    let endpoint = dir.path().join("sidecar.json");
    std::fs::write(&database, b"existing database").unwrap();
    std::fs::write(&endpoint, b"existing endpoint").unwrap();
    let _owner = InstanceGuard::acquire(dir.path()).unwrap();

    assert!(matches!(
        InstanceGuard::acquire(dir.path()),
        Err(InstanceError::AlreadyRunning)
    ));
    assert_eq!(std::fs::read(database).unwrap(), b"existing database");
    assert_eq!(std::fs::read(endpoint).unwrap(), b"existing endpoint");
}

#[test]
fn fresh_directory_and_normal_release_preserve_the_lock_anchor() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = dir.path().join("new-app-data");
    let owner = InstanceGuard::acquire(&runtime).unwrap();
    assert_eq!(owner.runtime_dir(), runtime.canonicalize().unwrap());
    let anchor = runtime.join(LOCK_FILE_NAME);
    drop(owner);

    assert!(anchor.is_file());
    std::fs::write(&anchor, b"do not truncate").unwrap();
    let next_owner = InstanceGuard::acquire(&runtime).unwrap();
    drop(next_owner);
    // Read only after unlocking: Windows byte-range locks can deny other I/O.
    assert_eq!(std::fs::read(&anchor).unwrap(), b"do not truncate");
    let _next_owner = InstanceGuard::acquire(&runtime).unwrap();
    assert!(!runtime.join("mt.db").exists());
    assert!(!runtime.join("sidecar.json").exists());
}

#[test]
fn invalid_location_returns_io_error_without_starting_work() {
    let dir = tempfile::tempdir().unwrap();
    let not_a_directory = dir.path().join("file");
    std::fs::write(&not_a_directory, b"preserve").unwrap();
    assert!(matches!(
        InstanceGuard::acquire(&not_a_directory),
        Err(InstanceError::Io(_))
    ));
    assert_eq!(std::fs::read(not_a_directory).unwrap(), b"preserve");
}

#[cfg(unix)]
#[test]
fn directory_symlink_cannot_bypass_instance_ownership() {
    let dir = tempfile::tempdir().unwrap();
    let runtime = dir.path().join("app-data");
    let alias = dir.path().join("alias");
    let _owner = InstanceGuard::acquire(&runtime).unwrap();
    std::os::unix::fs::symlink(&runtime, &alias).unwrap();
    assert!(matches!(
        InstanceGuard::acquire(&alias),
        Err(InstanceError::AlreadyRunning)
    ));
}

#[test]
fn independent_app_data_locations_can_start_separately() {
    let dir = tempfile::tempdir().unwrap();
    let _first = InstanceGuard::acquire(&dir.path().join("one")).unwrap();
    let _second = InstanceGuard::acquire(&dir.path().join("two")).unwrap();
}

// A real subprocess owns the lock. The ignored test is invoked explicitly by
// the parent tests below, never as part of ordinary test discovery.
#[test]
#[ignore = "subprocess helper for instance-lock tests"]
fn process_lock_holder() {
    let dir = std::env::var_os("MT_TEST_INSTANCE_DIR").unwrap();
    let _owner = InstanceGuard::acquire(Path::new(&dir)).unwrap();
    println!("MT_INSTANCE_LOCKED");
    std::io::stdout().flush().unwrap();
    let mut release = [0];
    std::io::stdin().read_exact(&mut release).unwrap();
}

struct LockProcess(Child);

impl LockProcess {
    fn start(dir: &Path) -> Self {
        let mut child = Self(
            Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "instance::tests::process_lock_holder",
                    "--ignored",
                    "--nocapture",
                ])
                .env("MT_TEST_INSTANCE_DIR", dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap(),
        );
        let stdout = child.0.stdout.take().unwrap();
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(stdout).lines() {
                if line.unwrap() == "MT_INSTANCE_LOCKED" {
                    let _ = sender.send(());
                }
                // Keep draining through exit: closing stdout at readiness makes
                // libtest's final summary fail with BrokenPipe.
            }
        });
        receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("lock-holder process did not become ready");
        child
    }

    fn wait(&mut self) -> std::process::ExitStatus {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = self.0.try_wait().unwrap() {
                return status;
            }
            assert!(std::time::Instant::now() < deadline, "child did not exit");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for LockProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn process_exit_releases_lock_for_relaunch() {
    let dir = tempfile::tempdir().unwrap();
    let mut child = LockProcess::start(dir.path());
    assert!(matches!(
        InstanceGuard::acquire(dir.path()),
        Err(InstanceError::AlreadyRunning)
    ));
    child.0.stdin.take().unwrap().write_all(&[1]).unwrap();
    assert!(child.wait().success());
    let _next_owner = InstanceGuard::acquire(dir.path()).unwrap();
}

#[test]
fn killed_process_releases_lock_without_deleting_stale_files() {
    let dir = tempfile::tempdir().unwrap();
    let mut child = LockProcess::start(dir.path());
    let endpoint = dir.path().join("sidecar.json");
    std::fs::write(&endpoint, b"stale endpoint").unwrap();
    assert!(matches!(
        InstanceGuard::acquire(dir.path()),
        Err(InstanceError::AlreadyRunning)
    ));
    child.0.kill().unwrap();
    assert!(!child.wait().success());
    let _next_owner = InstanceGuard::acquire(dir.path()).unwrap();
    assert_eq!(std::fs::read(endpoint).unwrap(), b"stale endpoint");
}
