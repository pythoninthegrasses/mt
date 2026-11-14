//! Audio file tag reading and writing for the metadata editor.
//!
//! The desktop crate keeps the Tauri command wrappers; everything here is
//! plain file I/O through lofty.

use lofty::config::{ParseOptions, ParsingMode, WriteOptions};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::Tag;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[cfg(test)]
mod tests;

/// Convert empty or whitespace-only tag strings to None.
fn non_empty(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrackMetadata {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub track_total: Option<u32>,
    pub disc_number: Option<u32>,
    pub disc_total: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub duration_ms: Option<u64>,
    pub format: Option<String>,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
}

#[derive(Debug, Deserialize)]
pub struct MetadataUpdate {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub track_total: Option<u32>,
    pub disc_number: Option<u32>,
    pub disc_total: Option<u32>,
    pub year: Option<u32>,
    pub genre: Option<String>,
}

pub fn get_track_metadata(path: String) -> Result<TrackMetadata, String> {
    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    let parse_options = ParseOptions::new().parsing_mode(ParsingMode::Relaxed);
    let tagged_file = match Probe::open(file_path) {
        Ok(probe) => probe.options(parse_options).read().ok(),
        Err(_) => None,
    };

    if let Some(tagged_file) = tagged_file {
        let tag = tagged_file
            .primary_tag()
            .or_else(|| tagged_file.first_tag());
        let properties = tagged_file.properties();

        let format = match tagged_file.file_type() {
            lofty::file::FileType::Aac => "AAC",
            lofty::file::FileType::Aiff => "AIFF",
            lofty::file::FileType::Ape => "APE",
            lofty::file::FileType::Flac => "FLAC",
            lofty::file::FileType::Mpeg => "MP3",
            lofty::file::FileType::Mp4 => "M4A",
            lofty::file::FileType::Mpc => "MPC",
            lofty::file::FileType::Opus => "Opus",
            lofty::file::FileType::Vorbis => "Ogg Vorbis",
            lofty::file::FileType::Speex => "Speex",
            lofty::file::FileType::Wav => "WAV",
            lofty::file::FileType::WavPack => "WavPack",
            _ => "Unknown",
        };

        let (
            title,
            artist,
            album,
            album_artist,
            track_number,
            track_total,
            disc_number,
            disc_total,
            year,
            genre,
        ) = if let Some(tag) = tag {
            (
                tag.title().and_then(|s| non_empty(&s)),
                tag.artist().and_then(|s| non_empty(&s)),
                tag.album().and_then(|s| non_empty(&s)),
                tag.get_string(&ItemKey::AlbumArtist).and_then(non_empty),
                tag.track(),
                tag.track_total(),
                tag.disk(),
                tag.disk_total(),
                tag.year(),
                tag.genre().and_then(|s| non_empty(&s)),
            )
        } else {
            (None, None, None, None, None, None, None, None, None, None)
        };

        Ok(TrackMetadata {
            path,
            title,
            artist,
            album,
            album_artist,
            track_number,
            track_total,
            disc_number,
            disc_total,
            year,
            genre,
            duration_ms: Some(properties.duration().as_millis() as u64),
            format: Some(format.to_string()),
            bitrate: properties.audio_bitrate(),
            sample_rate: properties.sample_rate(),
            channels: properties.channels(),
        })
    } else {
        // File exists but tags are unreadable — return empty metadata so the
        // editor can still open and the user can write new tags.
        tracing::warn!(
            "Could not parse tags for {:?}; returning empty metadata",
            path
        );
        Ok(TrackMetadata {
            path,
            title: None,
            artist: None,
            album: None,
            album_artist: None,
            track_number: None,
            track_total: None,
            disc_number: None,
            disc_total: None,
            year: None,
            genre: None,
            duration_ms: None,
            format: None,
            bitrate: None,
            sample_rate: None,
            channels: None,
        })
    }
}

pub fn get_tracks_metadata_batch(paths: Vec<String>) -> Result<Vec<TrackMetadata>, String> {
    let results: Vec<TrackMetadata> = paths
        .into_par_iter()
        .map(get_track_metadata)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(results)
}

pub fn save_track_metadata(update: MetadataUpdate) -> Result<TrackMetadata, String> {
    let file_path = Path::new(&update.path);

    if !file_path.exists() {
        return Err(format!("File not found: {}", update.path));
    }

    let parse_options = ParseOptions::new().parsing_mode(ParsingMode::Relaxed);
    let mut tagged_file = match Probe::open(file_path) {
        Ok(probe) => probe.options(parse_options).read().ok(),
        Err(_) => None,
    };

    let tag = if let Some(ref mut tf) = tagged_file {
        match tf.primary_tag_mut() {
            Some(primary_tag) => primary_tag,
            None => {
                if let Some(first_tag) = tf.first_tag_mut() {
                    first_tag
                } else {
                    let tag_type = tf.primary_tag_type();
                    tf.insert_tag(Tag::new(tag_type));
                    tf.primary_tag_mut().unwrap()
                }
            }
        }
    } else {
        // Existing tags are unreadable — detect file type from extension and
        // create a fresh tag that will replace the corrupted one.
        let tag_type = Probe::open(file_path)
            .ok()
            .and_then(|p| p.file_type())
            .map(|ft| ft.primary_tag_type())
            .unwrap_or(lofty::tag::TagType::Id3v2);

        // We cannot hold a borrow into tagged_file here, so build a
        // standalone tag, populate it, and save directly.
        let mut tag = Tag::new(tag_type);
        if let Some(title) = &update.title {
            tag.set_title(title.clone());
        }
        if let Some(artist) = &update.artist {
            tag.set_artist(artist.clone());
        }
        if let Some(album) = &update.album {
            tag.set_album(album.clone());
        }
        if let Some(album_artist) = &update.album_artist {
            tag.insert(lofty::tag::TagItem::new(
                ItemKey::AlbumArtist,
                lofty::tag::ItemValue::Text(album_artist.clone()),
            ));
        }
        if let Some(track) = update.track_number {
            tag.set_track(track);
        }
        if let Some(total) = update.track_total {
            tag.set_track_total(total);
        }
        if let Some(disc) = update.disc_number {
            tag.set_disk(disc);
        }
        if let Some(total) = update.disc_total {
            tag.set_disk_total(total);
        }
        if let Some(year) = update.year {
            tag.set_year(year);
        }
        if let Some(genre) = &update.genre {
            tag.set_genre(genre.clone());
        }
        tag.save_to_path(&update.path, WriteOptions::default())
            .map_err(|e| format!("Failed to save metadata: {}", e))?;
        return get_track_metadata(update.path);
    };

    if let Some(title) = &update.title {
        tag.set_title(title.clone());
    }
    if let Some(artist) = &update.artist {
        tag.set_artist(artist.clone());
    }
    if let Some(album) = &update.album {
        tag.set_album(album.clone());
    }
    if let Some(album_artist) = &update.album_artist {
        tag.insert(lofty::tag::TagItem::new(
            ItemKey::AlbumArtist,
            lofty::tag::ItemValue::Text(album_artist.clone()),
        ));
    }
    if let Some(track) = update.track_number {
        tag.set_track(track);
    }
    if let Some(total) = update.track_total {
        tag.set_track_total(total);
    }
    if let Some(disc) = update.disc_number {
        tag.set_disk(disc);
    }
    if let Some(total) = update.disc_total {
        tag.set_disk_total(total);
    }
    if let Some(year) = update.year {
        tag.set_year(year);
    }
    if let Some(genre) = &update.genre {
        tag.set_genre(genre.clone());
    }

    tag.save_to_path(&update.path, WriteOptions::default())
        .map_err(|e| format!("Failed to save metadata: {}", e))?;

    get_track_metadata(update.path)
}
