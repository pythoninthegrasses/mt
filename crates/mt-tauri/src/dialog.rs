use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

#[tauri::command]
pub async fn open_file_dialog(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = oneshot::channel();
    
    app.dialog()
        .file()
        .add_filter("Audio Files", &["mp3", "m4a", "flac", "ogg", "wav", "aac", "wma", "opus"])
        .add_filter("All Files", &["*"])
        .set_title("Select audio files to add to your library")
        .pick_files(move |paths| {
            let result = paths.map(|p| {
                p.iter()
                    .filter_map(|path| path.as_path().map(|p| p.to_string_lossy().to_string()))
                    .collect::<Vec<_>>()
            }).unwrap_or_default();
            let _ = tx.send(result);
        });
    
    let paths = rx.await.map_err(|e| format!("Dialog error: {}", e))?;
    println!("[dialog] open_file_dialog: {} files selected", paths.len());
    Ok(paths)
}

#[tauri::command]
pub async fn open_folder_dialog(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = oneshot::channel();
    
    app.dialog()
        .file()
        .set_title("Select folders to add to your library")
        .pick_folders(move |paths| {
            let result = paths.map(|p| {
                p.iter()
                    .filter_map(|path| path.as_path().map(|p| p.to_string_lossy().to_string()))
                    .collect::<Vec<_>>()
            }).unwrap_or_default();
            let _ = tx.send(result);
        });
    
    let paths = rx.await.map_err(|e| format!("Dialog error: {}", e))?;
    println!("[dialog] open_folder_dialog: {} folders selected", paths.len());
    Ok(paths)
}

#[tauri::command]
pub async fn open_add_music_dialog(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = oneshot::channel();
    
    app.dialog()
        .file()
        .set_title("Select folders to add to your library")
        .pick_folders(move |paths| {
            let result = paths.map(|p| {
                p.iter()
                    .filter_map(|path| path.as_path().map(|p| p.to_string_lossy().to_string()))
                    .collect::<Vec<_>>()
            }).unwrap_or_default();
            let _ = tx.send(result);
        });
    
    let paths = rx.await.map_err(|e| format!("Dialog error: {}", e))?;
    println!("[dialog] open_add_music_dialog: {} paths selected: {:?}", paths.len(), paths);
    Ok(paths)
}
