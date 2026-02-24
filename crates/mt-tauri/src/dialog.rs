use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;
use tracing::debug;

#[tracing::instrument(skip(app))]
#[tauri::command]
pub(crate) async fn open_file_dialog(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = oneshot::channel();

    app.dialog()
        .file()
        .add_filter(
            "Audio Files",
            &["mp3", "m4a", "flac", "ogg", "wav", "aac", "wma", "opus"],
        )
        .add_filter("All Files", &["*"])
        .set_title("Select audio files to add to your library")
        .pick_files(move |paths| {
            let result = paths
                .map(|p| {
                    p.iter()
                        .filter_map(|path| path.as_path().map(|p| p.to_string_lossy().to_string()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let _ = tx.send(result);
        });

    let paths = rx.await.map_err(|e| format!("Dialog error: {}", e))?;
    debug!(count = paths.len(), "Files selected via open_file_dialog");
    Ok(paths)
}

#[tracing::instrument(skip(app))]
#[tauri::command]
pub(crate) async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = oneshot::channel();

    app.dialog()
        .file()
        .set_title("Select folders to add to your library")
        .pick_folders(move |paths| {
            let result = paths
                .map(|p| {
                    p.iter()
                        .filter_map(|path| path.as_path().map(|p| p.to_string_lossy().to_string()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let _ = tx.send(result);
        });

    let paths = rx.await.map_err(|e| format!("Dialog error: {}", e))?;
    debug!(
        count = paths.len(),
        "Folders selected via open_folder_dialog"
    );
    Ok(paths)
}

/// Open a native file picker that allows selecting both individual files and directories.
///
/// - macOS: Uses NSOpenPanel with canChooseFiles + canChooseDirectories (native behavior).
/// - Linux: Falls back to file-only selection since GTK does not support combined mode.
#[tracing::instrument(skip(app))]
#[tauri::command]
pub(crate) async fn open_add_music_dialog(
    #[allow(unused_variables)] app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let paths = open_add_music_dialog_impl(app).await?;
    debug!(
        count = paths.len(),
        ?paths,
        "Paths selected via open_add_music_dialog"
    );
    Ok(paths)
}

#[cfg(target_os = "macos")]
async fn open_add_music_dialog_impl(_app: tauri::AppHandle) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(open_combined_dialog_macos)
        .await
        .map_err(|e| format!("Dialog error: {}", e))
}

#[cfg(not(target_os = "macos"))]
async fn open_add_music_dialog_impl(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    // GTK on Linux does not support combined file+folder selection.
    // Fall back to file selection with audio filters.
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter(
            "Audio Files",
            &["mp3", "m4a", "flac", "ogg", "wav", "aac", "wma", "opus"],
        )
        .add_filter("All Files", &["*"])
        .set_title("Select audio files to add to your library")
        .pick_files(move |paths| {
            let result = paths
                .map(|p| {
                    p.iter()
                        .filter_map(|path| path.as_path().map(|p| p.to_string_lossy().to_string()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let _ = tx.send(result);
        });
    rx.await.map_err(|e| format!("Dialog error: {}", e))
}

/// macOS: create an NSOpenPanel that allows selecting both files and directories.
#[cfg(target_os = "macos")]
fn open_combined_dialog_macos() -> Vec<String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSOpenPanel;
    use objc2_foundation::{NSArray, NSString, NSURL};
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel();

    // NSOpenPanel.runModal() must execute on the main thread.
    dispatch2::DispatchQueue::main().exec_sync(move || {
        // Safe: we are on the main thread via dispatch_sync.
        let mtm = MainThreadMarker::new().unwrap();
        let panel = NSOpenPanel::openPanel(mtm);

        panel.setCanChooseFiles(true);
        panel.setCanChooseDirectories(true);
        panel.setAllowsMultipleSelection(true);
        let title = NSString::from_str("Add music to library");
        panel.setTitle(Some(&title));

        let response = panel.runModal();
        let mut paths: Vec<String> = Vec::new();

        // NSModalResponseOK = 1
        if response == 1 {
            let urls: objc2::rc::Retained<NSArray<NSURL>> = panel.URLs();
            let count = urls.count();
            for i in 0..count {
                let url = urls.objectAtIndex(i);
                let path_opt: Option<objc2::rc::Retained<NSString>> = url.path();
                if let Some(p) = path_opt {
                    paths.push(format!("{p}"));
                }
            }
        }

        let _ = tx.send(paths);
    });

    rx.recv().unwrap_or_default()
}
