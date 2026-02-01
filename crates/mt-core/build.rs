use std::path::PathBuf;

fn main() {
    // Get absolute path to workspace root from CARGO_MANIFEST_DIR
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let workspace_root = manifest_dir.parent().unwrap().parent().unwrap();
    let zig_core_dir = workspace_root.join("zig-core");
    let zig_lib_dir = zig_core_dir.join("zig-out").join("lib");

    // Build Zig library first
    let status = std::process::Command::new("zig")
        .args(["build", "-Doptimize=ReleaseFast"])
        .current_dir(&zig_core_dir)
        .status()
        .expect("failed to build zig-core");

    assert!(status.success(), "zig-core build failed");

    // Link the static library using absolute path
    println!("cargo:rustc-link-search=native={}", zig_lib_dir.display());
    println!("cargo:rustc-link-lib=static=mtcore");

    // Link TagLib (required by zig-core) via pkg-config
    pkg_config::Config::new()
        .probe("taglib_c")
        .expect("failed to find taglib_c via pkg-config");

    // Rebuild if zig sources change
    println!("cargo:rerun-if-changed={}", zig_core_dir.join("src").display());
}
