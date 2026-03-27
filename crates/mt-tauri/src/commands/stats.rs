//! Tauri commands for listening statistics.

use ab_glyph::{FontArc, PxScale};
use image::ImageEncoder;
use imageproc::drawing::draw_text_mut;
use tauri::State;

use crate::db::{
    ArtistPlayCount, ChartGridRequest, Database, GenreBreakdown, ListeningStats, PlaysOverTime,
    StatsDateRange, stats,
};
use crate::scanner::artwork_cache::ArtworkCache;

/// Load a system font for placeholder text rendering.
fn load_system_font() -> Option<FontArc> {
    let candidates = if cfg!(target_os = "macos") {
        vec![
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/SFNSText.ttf",
        ]
    } else if cfg!(target_os = "windows") {
        vec![
            "C:\\Windows\\Fonts\\arial.ttf",
            "C:\\Windows\\Fonts\\segoeui.ttf",
        ]
    } else {
        vec![
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
        ]
    };

    for path in candidates {
        if let Ok(data) = std::fs::read(path) {
            if let Ok(font) = FontArc::try_from_vec(data) {
                return Some(font);
            }
        }
    }
    None
}

/// Draw a placeholder cell with artist name text, fitting within the given dimensions.
fn draw_placeholder(
    canvas: &mut image::RgbaImage,
    x: u32,
    y: u32,
    size: u32,
    artist: &str,
    album: &str,
    font: &FontArc,
) {
    // Fill cell with a slightly lighter background (zinc-800: rgb(39, 39, 42))
    for py in y..y + size {
        for px in x..x + size {
            if px < canvas.width() && py < canvas.height() {
                canvas.put_pixel(px, py, image::Rgba([39, 39, 42, 255]));
            }
        }
    }

    let margin = (size as f32 * 0.08) as u32;
    let usable = size - 2 * margin;

    // Draw artist name — scale font to fit width
    let text = if artist.is_empty() { album } else { artist };
    if text.is_empty() {
        return;
    }

    // Find the largest font size where all wrapped lines fit both
    // horizontally (each line <= usable width) and vertically.
    let max_scale = size as f32 * 0.2;
    let min_scale = size as f32 * 0.06;
    let mut scale = max_scale;

    while scale > min_scale {
        let px = PxScale::from(scale);
        let lines = wrap_text(text, font, px, usable as f32);
        let line_height = scale * 1.2;
        let total_height = lines.len() as f32 * line_height;
        let all_fit_width = lines
            .iter()
            .all(|l| measure_text(l, font, px) <= usable as f32);
        if total_height <= usable as f32 && all_fit_width {
            break;
        }
        scale -= 1.0;
    }

    let px_scale = PxScale::from(scale);
    let lines = wrap_text(text, font, px_scale, usable as f32);
    let line_height = scale * 1.2;
    let total_height = lines.len() as f32 * line_height;

    // Center vertically
    let start_y = y + margin + ((usable as f32 - total_height) / 2.0).max(0.0) as u32;
    let color = image::Rgba([161, 161, 170, 255]); // zinc-400

    for (i, line) in lines.iter().enumerate() {
        let line_width = measure_text(line, font, px_scale);
        // Center horizontally
        let line_x = x + margin + ((usable as f32 - line_width) / 2.0).max(0.0) as u32;
        let line_y = start_y + (i as f32 * line_height) as u32;
        draw_text_mut(canvas, color, line_x as i32, line_y as i32, px_scale, font, line);
    }
}

/// Measure the width of rendered text.
fn measure_text(text: &str, font: &FontArc, scale: PxScale) -> f32 {
    use ab_glyph::{Font, ScaleFont};
    let scaled = font.as_scaled(scale);
    let mut width = 0.0;
    let mut prev = None;
    for ch in text.chars() {
        let glyph_id = scaled.glyph_id(ch);
        if let Some(prev_id) = prev {
            width += scaled.kern(prev_id, glyph_id);
        }
        width += scaled.h_advance(glyph_id);
        prev = Some(glyph_id);
    }
    width
}

/// Wrap text into lines that fit within max_width.
fn wrap_text(text: &str, font: &FontArc, scale: PxScale, max_width: f32) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return vec![text.to_string()];
    }

    let mut lines = Vec::new();
    let mut current_line = String::new();

    for word in &words {
        let candidate = if current_line.is_empty() {
            word.to_string()
        } else {
            format!("{current_line} {word}")
        };

        if measure_text(&candidate, font, scale) <= max_width {
            current_line = candidate;
        } else if current_line.is_empty() {
            // Single word wider than max — just use it
            lines.push(word.to_string());
        } else {
            lines.push(current_line);
            current_line = word.to_string();
        }
    }
    if !current_line.is_empty() {
        lines.push(current_line);
    }
    lines
}

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

    let font = load_system_font();

    for (idx, album) in albums.iter().enumerate() {
        if idx >= total_cells {
            break;
        }

        let row = idx / cols;
        let col = idx % cols;
        let x_offset = col as u32 * (cell_size + padding);
        let y_offset = row as u32 * (cell_size + padding);

        // Load artwork from cache
        let has_artwork = if let Some(artwork) =
            cache.get_or_load(album.track_id, &album.filepath)
            && let Ok(decoded) =
                base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &artwork.data)
            && let Ok(img) = image::load_from_memory(&decoded)
        {
            let resized =
                img.resize_exact(cell_size, cell_size, image::imageops::FilterType::Lanczos3);
            let rgba = resized.to_rgba8();
            image::imageops::overlay(&mut canvas, &rgba, x_offset as i64, y_offset as i64);
            true
        } else {
            false
        };

        if !has_artwork {
            if let Some(ref font) = font {
                draw_placeholder(
                    &mut canvas,
                    x_offset,
                    y_offset,
                    cell_size,
                    &album.artist,
                    &album.album,
                    font,
                );
            }
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
