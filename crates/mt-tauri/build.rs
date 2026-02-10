fn main() {
    // Embed Last.fm API keys at compile time (from build environment).
    // Runtime env vars override these values for dev flexibility.
    for var in ["LASTFM_API_KEY", "LASTFM_API_SECRET"] {
        println!("cargo:rerun-if-env-changed={var}");
        if let Ok(val) = std::env::var(var) {
            println!("cargo:rustc-env={var}={val}");
        }
    }

    tauri_build::build()
}
