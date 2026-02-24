/**
 * Pure utility functions for artist computation and album grouping.
 * Extracted from artists-browser to reduce component complexity.
 */

/**
 * Build a map of album → canonical artist. Uses the most common non-null
 * album_artist per album. Albums where any track has null album_artist
 * are treated as compilations and excluded, so each track maps to its
 * own artist independently.
 *
 * @param {Array} tracks - All library tracks
 * @returns {Map<string, string>} Map of album name → canonical artist name
 */
export function buildCanonicalArtistMap(tracks) {
  const albumInfo = new Map();
  for (const track of tracks) {
    const album = track.album || '';
    const aa = (track.album_artist || '').replace(/;+$/, '').trim() || null;
    if (!albumInfo.has(album)) {
      albumInfo.set(album, { counts: new Map(), hasNull: false });
    }
    const info = albumInfo.get(album);
    if (!aa) {
      info.hasNull = true;
    } else {
      info.counts.set(aa, (info.counts.get(aa) || 0) + 1);
    }
  }

  const map = new Map();
  for (const [album, info] of albumInfo) {
    if (info.hasNull || info.counts.size === 0) continue;
    let bestArtist = '';
    let bestCount = 0;
    for (const [artist, count] of info.counts) {
      if (count > bestCount) {
        bestCount = count;
        bestArtist = artist;
      }
    }
    if (bestArtist) map.set(album, bestArtist);
  }
  return map;
}

/**
 * Case-insensitive dedup: collect all artists (canonical + per-track for
 * compilations), pick the most-frequent casing as the display name.
 *
 * @param {Array} tracks - All library tracks
 * @param {Map<string, string>} canonicalMap - From buildCanonicalArtistMap
 * @returns {Map<string, string>} Map of lowercased name → display name
 */
export function buildArtistDisplayNames(tracks, canonicalMap) {
  const countMap = new Map();

  const addArtist = (name) => {
    if (!name) return;
    const lower = name.toLowerCase();
    if (!countMap.has(lower)) countMap.set(lower, new Map());
    const formCounts = countMap.get(lower);
    formCounts.set(name, (formCounts.get(name) || 0) + 1);
  };

  for (const canonical of canonicalMap.values()) {
    addArtist(canonical);
  }

  for (const track of tracks) {
    const album = track.album || '';
    if (!canonicalMap.has(album)) {
      const artist = (track.album_artist || track.artist || '').replace(/;+$/, '').trim();
      addArtist(artist);
    }
  }

  const displayMap = new Map();
  for (const [lower, formCounts] of countMap) {
    let bestForm = '';
    let bestCount = 0;
    for (const [form, count] of formCounts) {
      if (count > bestCount) {
        bestCount = count;
        bestForm = form;
      }
    }
    displayMap.set(lower, bestForm);
  }
  return displayMap;
}

/**
 * Group sorted tracks into album objects with per-album track sorting.
 *
 * @param {Array} tracks - Tracks already filtered to one artist
 * @param {Function} parseDiscNumber - Disc number parser
 * @param {Function} parseTrackNumber - Track number parser
 * @returns {Array} Album objects sorted by year descending, then name
 */
export function groupTracksIntoAlbums(tracks, parseDiscNumber, parseTrackNumber) {
  const albumMap = {};

  for (const track of tracks) {
    const albumName = track.album || 'Unknown Album';
    if (!albumMap[albumName]) {
      albumMap[albumName] = {
        name: albumName,
        year: track.date || '',
        genre: track.genre || '',
        tracks: [],
        representativeTrackId: track.id,
      };
    }
    albumMap[albumName].tracks.push(track);
    if (track.date && !albumMap[albumName].year) {
      albumMap[albumName].year = track.date;
    }
    if (track.genre && !albumMap[albumName].genre) {
      albumMap[albumName].genre = track.genre;
    }
  }

  // Sort each album's tracks: disc → track, with null disc inheriting
  // the album's most common disc number so tracks interleave correctly.
  for (const album of Object.values(albumMap)) {
    const discCounts = {};
    for (const t of album.tracks) {
      if (t.disc_number != null) {
        const d = parseDiscNumber(t.disc_number);
        discCounts[d] = (discCounts[d] || 0) + 1;
      }
    }
    const dominantDisc = Number(
      Object.entries(discCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1,
    );
    album.tracks.sort((a, b) => {
      const discA = a.disc_number != null ? parseDiscNumber(a.disc_number) : dominantDisc;
      const discB = b.disc_number != null ? parseDiscNumber(b.disc_number) : dominantDisc;
      if (discA !== discB) return discA - discB;
      return parseTrackNumber(a.track_number) - parseTrackNumber(b.track_number);
    });
  }

  return Object.values(albumMap).sort((a, b) => {
    const yearA = parseInt(a.year) || 0;
    const yearB = parseInt(b.year) || 0;
    if (yearA !== yearB) return yearB - yearA;
    return a.name.localeCompare(b.name);
  });
}
