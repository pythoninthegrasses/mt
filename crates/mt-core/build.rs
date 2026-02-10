use std::path::PathBuf;

fn main() {
    // Get absolute path to workspace root from CARGO_MANIFEST_DIR
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let workspace_root = manifest_dir.parent().unwrap().parent().unwrap();
    let zig_core_dir = workspace_root.join("zig-core");
    let zig_lib_dir = zig_core_dir.join("zig-out").join("lib");
    let vendor_taglib_lib = workspace_root.join("vendor").join("taglib").join("lib");

    // Build TagLib static libraries if not present
    if !vendor_taglib_lib.join("libtag.a").exists()
        || !vendor_taglib_lib.join("libtag_c.a").exists()
    {
        let build_script = workspace_root.join("scripts").join("build-taglib.sh");
        eprintln!("TagLib static libraries not found, running {}...", build_script.display());
        let status = std::process::Command::new("bash")
            .arg(&build_script)
            .status()
            .expect("failed to run scripts/build-taglib.sh");
        assert!(status.success(), "TagLib static build failed");
    }

    // Build Zig library
    let status = std::process::Command::new("zig")
        .args(["build", "-Doptimize=ReleaseSmall"])
        .current_dir(&zig_core_dir)
        .status()
        .expect("failed to build zig-core");

    assert!(status.success(), "zig-core build failed");

    // Link the Zig static library
    println!("cargo:rustc-link-search=native={}", zig_lib_dir.display());
    println!("cargo:rustc-link-lib=static=mtcore");

    // Link TagLib statically from vendor directory
    println!(
        "cargo:rustc-link-search=native={}",
        vendor_taglib_lib.display()
    );
    println!("cargo:rustc-link-lib=static=tag_c");
    println!("cargo:rustc-link-lib=static=tag");

    // TagLib depends on zlib and C++ standard library
    println!("cargo:rustc-link-lib=z");
    if cfg!(target_os = "macos") {
        println!("cargo:rustc-link-lib=c++");
    } else {
        println!("cargo:rustc-link-lib=stdc++");
    }

    // Rebuild if zig sources or vendor libs change
    println!(
        "cargo:rerun-if-changed={}",
        zig_core_dir.join("src").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        vendor_taglib_lib.join("libtag.a").display()
    );
}
