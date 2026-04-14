#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Subprocess mode: enumerate audio devices and exit.
    // Used by safe_list_output_devices() to isolate CoreAudio HAL crashes
    // from the main process.
    if std::env::var("MT_ENUMERATE_DEVICES").is_ok() {
        mt_lib::audio::enumerate_devices_to_stdout();
        // enumerate_devices_to_stdout calls process::exit, but just in case:
        return;
    }

    mt_lib::run()
}
