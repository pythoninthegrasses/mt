//! Tauri commands for listening statistics.

use image::ImageEncoder;
use tauri::State;

use crate::db::{
    ArtistPlayCount, ChartGridRequest, Database, GenreBreakdown, ListeningStats, PlaysOverTime,
    StatsDateRange, stats,
};
use crate::scanner::artwork_cache::ArtworkCache;

/// Get listening statistics overview
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn stats_get_overview(
    db: State<'_, Database>,
    range: StatsDateRange,
) -> Result<ListeningStats, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    stats::get_listening_stats(&conn, &range).map_err(|e| e.to_string())
}

/// Get top artists by play count
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn stats_get_top_artists(
    db: State<'_, Database>,
    range: StatsDateRange,
    limit: Option<i64>,
) -> Result<Vec<ArtistPlayCount>, String> {
    let limit = limit.unwrap_or(25).clamp(1, 100);
    let conn = db.conn().map_err(|e| e.to_string())?;
    stats::get_top_artists(&conn, &range, limit).map_err(|e| e.to_string())
}

/// Get genre breakdown
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn stats_get_genres(
    db: State<'_, Database>,
    range: StatsDateRange,
    limit: Option<i64>,
) -> Result<Vec<GenreBreakdown>, String> {
    let limit = limit.unwrap_or(20).clamp(1, 50);
    let conn = db.conn().map_err(|e| e.to_string())?;
    stats::get_genre_breakdown(&conn, &range, limit).map_err(|e| e.to_string())
}

/// Get plays over time
#[tracing::instrument(skip(db))]
#[tauri::command]
pub(crate) fn stats_get_plays_over_time(
    db: State<'_, Database>,
    range: StatsDateRange,
) -> Result<Vec<PlaysOverTime>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    stats::get_plays_over_time(&conn, &range).map_err(|e| e.to_string())
}

/// Generate a chart grid image from top album artwork
#[tracing::instrument(skip(db, cache))]
#[tauri::command]
pub(crate) fn stats_generate_chart_grid(
    db: State<'_, Database>,
    cache: State<'_, ArtworkCache>,
    request: ChartGridRequest,
) -> Result<String, String> {
    let rows = request.rows.clamp(1, 10) as usize;
    let cols = request.columns.clamp(1, 10) as usize;
    let cell_size = request.cell_size.clamp(50, 600);
    let padding = request.padding.clamp(0, 20);
    let total_cells = rows * cols;

    let conn = db.conn().map_err(|e| e.to_string())?;
    let albums = stats::get_top_albums_for_grid(
        &conn,
        &request.date_range,
        &request.sort_by,
        total_cells as i64,
    )
    .map_err(|e| e.to_string())?;

    let canvas_width = cols as u32 * cell_size + (cols as u32 - 1) * padding;
    let canvas_height = rows as u32 * cell_size + (rows as u32 - 1) * padding;

    let mut canvas = image::RgbaImage::new(canvas_width, canvas_height);

    // Fill with dark background (zinc-900: rgb(24, 24, 27))
    for pixel in canvas.pixels_mut() {
        *pixel = image::Rgba([24, 24, 27, 255]);
    }

    for (idx, album) in albums.iter().enumerate() {
        if idx >= total_cells {
            break;
        }

        let row = idx / cols;
        let col = idx % cols;
        let x_offset = col as u32 * (cell_size + padding);
        let y_offset = row as u32 * (cell_size + padding);

        // Load artwork from cache
        if let Some(artwork) = cache.get_or_load(album.track_id, &album.filepath)
            && let Ok(decoded) =
                base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &artwork.data)
            && let Ok(img) = image::load_from_memory(&decoded)
        {
            let resized =
                img.resize_exact(cell_size, cell_size, image::imageops::FilterType::Lanczos3);
            let rgba = resized.to_rgba8();
            image::imageops::overlay(&mut canvas, &rgba, x_offset as i64, y_offset as i64);
        }
    }

    // Encode to PNG
    let mut png_bytes = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
    encoder
        .write_image(
            canvas.as_raw(),
            canvas_width,
            canvas_height,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| format!("Failed to encode PNG: {e}"))?;

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png_bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}
