/// Detect whether a file path resides on a network mount (SMB/NFS/CIFS).
///
/// Returns `true` when the path is on a remote filesystem.
/// Returns `false` for local paths, non-existent paths, or on detection failure.
#[cfg(target_os = "macos")]
pub fn is_network_mount(path: &str) -> bool {
    macos::is_network_mount_impl(path)
}

#[cfg(target_os = "linux")]
pub fn is_network_mount(path: &str) -> bool {
    linux::is_network_mount_impl(path)
}

#[cfg(target_os = "windows")]
pub fn is_network_mount(path: &str) -> bool {
    windows::is_network_mount_impl(path)
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::CString;
    use std::path::Path;

    /// MNT_LOCAL flag from <sys/mount.h>
    const MNT_LOCAL: u32 = 0x0000_1000;

    pub fn is_network_mount_impl(path: &str) -> bool {
        let real_path = match Path::new(path).canonicalize() {
            Ok(p) => p,
            Err(_) => return false,
        };

        let c_path = match CString::new(real_path.to_string_lossy().as_bytes()) {
            Ok(c) => c,
            Err(_) => return false,
        };

        unsafe {
            let mut stat: libc::statfs = std::mem::zeroed();
            if libc::statfs(c_path.as_ptr(), &mut stat) != 0 {
                return false;
            }
            // If MNT_LOCAL is NOT set, the filesystem is remote
            (stat.f_flags & MNT_LOCAL) == 0
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::path::Path;

    const NETWORK_FS_TYPES: &[&str] =
        &["nfs", "nfs4", "cifs", "smbfs", "fuse.sshfs", "ncpfs", "9p"];

    pub fn is_network_mount_impl(path: &str) -> bool {
        let real_path = match Path::new(path).canonicalize() {
            Ok(p) => p,
            Err(_) => return false,
        };

        let mounts = match std::fs::read_to_string("/proc/mounts") {
            Ok(m) => m,
            Err(_) => return false,
        };

        // Find the mount with the longest prefix match
        let path_str = real_path.to_string_lossy();
        let mut best_mount_point = "";
        let mut best_fs_type = "";

        for line in mounts.lines() {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 3 {
                continue;
            }
            let mount_point = fields[1];
            let fs_type = fields[2];

            if path_str.starts_with(mount_point) && mount_point.len() > best_mount_point.len() {
                best_mount_point = mount_point;
                best_fs_type = fs_type;
            }
        }

        NETWORK_FS_TYPES.contains(&best_fs_type)
    }
}

#[cfg(target_os = "windows")]
mod windows {
    pub fn is_network_mount_impl(path: &str) -> bool {
        // UNC paths (\\server\share\...) are network paths
        if path.starts_with("\\\\") {
            return true;
        }

        // Check if the drive is a network drive via GetDriveTypeW
        if let Some(drive_root) = drive_root_from_path(path) {
            let wide: Vec<u16> = drive_root
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            unsafe {
                let drive_type =
                    windows_sys::Win32::Storage::FileSystem::GetDriveTypeW(wide.as_ptr());
                // DRIVE_REMOTE == 4
                return drive_type == 4;
            }
        }

        false
    }

    fn drive_root_from_path(path: &str) -> Option<String> {
        let bytes = path.as_bytes();
        if bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/')
        {
            Some(format!("{}:\\", bytes[0] as char))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_local_path_returns_false() {
        // A path in the temp directory should be local
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.txt");
        std::fs::write(&file, b"hello").unwrap();
        assert!(!is_network_mount(file.to_str().unwrap()));
    }

    #[test]
    fn test_nonexistent_path_returns_false() {
        assert!(!is_network_mount("/nonexistent/path/file.mp3"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_unc_path_detected() {
        assert!(is_network_mount("\\\\server\\share\\music\\song.mp3"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_local_drive_not_network() {
        // C:\ is almost always local
        assert!(!is_network_mount("C:\\Windows\\System32"));
    }
}
