/**
 * Tests for artist-utils.js utility functions
 *
 * Covers:
 * - groupTracksIntoAlbums: album sorting by year ascending
 * - Albums without year metadata appear at end
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { groupTracksIntoAlbums } from '../js/utils/artist-utils.js';

function createMockTrack(id, overrides = {}) {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Test Artist',
    album: 'Test Album',
    album_artist: 'Test Artist',
    duration: 180000,
    file_path: `/music/track${id}.mp3`,
    track_number: '1',
    disc_number: '1',
    date: '',
    genre: '',
    ...overrides,
  };
}

function parseDiscNumber(val) {
  return parseInt(String(val || '1').split('/')[0], 10) || 1;
}

function parseTrackNumber(val) {
  return parseInt(String(val || '').split('/')[0], 10) || 999999;
}

describe('groupTracksIntoAlbums', () => {
  describe('album sorting by year', () => {
    it('sorts albums by year ascending (oldest first)', () => {
      const tracks = [
        createMockTrack(1, { album: 'Album 2017', date: '2017' }),
        createMockTrack(2, { album: 'Album 2009', date: '2009' }),
        createMockTrack(3, { album: 'Album 2015', date: '2015' }),
        createMockTrack(4, { album: 'Album 2011', date: '2011' }),
      ];

      const albums = groupTracksIntoAlbums(tracks, parseDiscNumber, parseTrackNumber);

      expect(albums.map((a) => a.name)).toEqual([
        'Album 2009',
        'Album 2011',
        'Album 2015',
        'Album 2017',
      ]);
    });

    it('places albums without year metadata at the end', () => {
      const tracks = [
        createMockTrack(1, { album: 'Album 2015', date: '2015' }),
        createMockTrack(2, { album: 'No Year Album', date: '' }),
        createMockTrack(3, { album: 'Album 2010', date: '2010' }),
        createMockTrack(4, { album: 'Another No Year', date: null }),
      ];

      const albums = groupTracksIntoAlbums(tracks, parseDiscNumber, parseTrackNumber);

      expect(albums.map((a) => a.name)).toEqual([
        'Album 2010',
        'Album 2015',
        'Another No Year',
        'No Year Album',
      ]);
    });

    it('sorts albums without year alphabetically among themselves', () => {
      const tracks = [
        createMockTrack(1, { album: 'Zebra Album', date: '' }),
        createMockTrack(2, { album: 'Apple Album', date: '' }),
        createMockTrack(3, { album: 'Album 2020', date: '2020' }),
      ];

      const albums = groupTracksIntoAlbums(tracks, parseDiscNumber, parseTrackNumber);

      expect(albums.map((a) => a.name)).toEqual([
        'Album 2020',
        'Apple Album',
        'Zebra Album',
      ]);
    });

    it('sorts albums with same year alphabetically', () => {
      const tracks = [
        createMockTrack(1, { album: 'Zebra', date: '2015' }),
        createMockTrack(2, { album: 'Apple', date: '2015' }),
        createMockTrack(3, { album: 'Middle', date: '2015' }),
      ];

      const albums = groupTracksIntoAlbums(tracks, parseDiscNumber, parseTrackNumber);

      expect(albums.map((a) => a.name)).toEqual(['Apple', 'Middle', 'Zebra']);
    });
  });
});
