fn main() {
    // The Zig library (libmtcore.a) is built and linked by the mt-core crate.
    // Link directives from mt-core's build.rs propagate to this crate.
    // We just need to run tauri_build here.
    tauri_build::build()
}
