import { DEFAULT_SORT_IGNORE_WORDS } from '../constants.js';

/**
 * Type-to-jump mixin for library browser.
 * Handles keyboard-driven artist navigation: type a letter to jump to matching artist,
 * repeat the same letter to cycle through matching artists.
 */
export function typeToJumpMixin() {
  return {
    // State
    _typeBuffer: '',
    _typeDebounceTimer: null,
    _cycleChar: '',
    _cycleIndex: -1,

    /**
     * Handle type-to-jump navigation - jump to artist matching typed characters
     * @param {KeyboardEvent} event
     */
    handleTypeToJump(event) {
      // Only in library view
      if (this.$store.ui.view !== 'library') return;

      // Ignore if typing in input field
      if (this.isTypingInInput(event)) return;

      // Ignore modifier-only keys and non-printable characters
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1) return; // Only single printable chars

      const ch = event.key.toLowerCase();

      // Detect repeated same-letter press (cycling mode)
      // If buffer is all the same char and new char matches, cycle to next artist
      if (
        this._typeBuffer.length >= 1 &&
        ch === this._typeBuffer[0].toLowerCase() &&
        this._typeBuffer.split('').every((c) => c.toLowerCase() === ch)
      ) {
        this._typeBuffer += event.key;
        this.cycleToNextArtist(ch);
        this.resetTypeDebounce();
        return;
      }

      // Normal mode: append to buffer and search
      this._typeBuffer += event.key;
      this._cycleChar = '';
      this._cycleIndex = -1;
      this.jumpToMatchingArtist(this._typeBuffer);

      // Reset debounce timer
      this.resetTypeDebounce();
    },

    /**
     * Strip leading ignore word prefix from a string (respects sortIgnoreWords setting)
     * @param {string} value - String to process (lowercase)
     * @returns {string} String with prefix removed if ignore words enabled
     */
    stripIgnoredPrefix(value) {
      const uiStore = this.$store.ui;
      if (!uiStore.sortIgnoreWords) {
        return value;
      }

      // Fall back to default list when user clears the input
      const wordsList = uiStore.sortIgnoreWordsList?.trim() || DEFAULT_SORT_IGNORE_WORDS;

      const ignoreWords = wordsList
        .split(',')
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean);

      for (const word of ignoreWords) {
        const prefix = word + ' ';
        if (value.startsWith(prefix)) {
          return value.slice(prefix.length);
        }
      }
      return value;
    },

    /**
     * Find and scroll to first track with artist matching the query.
     * Prefers stripped prefix match (ignore words removed) over raw artist name match.
     * @param {string} query - The search query (typed characters)
     */
    jumpToMatchingArtist(query) {
      const normalizedQuery = query.toLowerCase();
      const tracks = this.library.filteredTracks;

      let fallback = null;

      for (const track of tracks) {
        if (!track.artist) continue;
        const artist = track.artist.toLowerCase();

        // Best match: artist starts with query after stripping ignore words
        const strippedArtist = this.stripIgnoredPrefix(artist);
        if (strippedArtist.startsWith(normalizedQuery)) {
          this.selectedTracks.clear();
          this.selectedTracks.add(track.id);
          this.scrollToTrack(track.id);
          return;
        }

        // Fallback: raw artist name starts with query (e.g., user types "the")
        if (!fallback && artist.startsWith(normalizedQuery)) {
          fallback = track;
        }
      }

      if (fallback) {
        this.selectedTracks.clear();
        this.selectedTracks.add(fallback.id);
        this.scrollToTrack(fallback.id);
      }
    },

    /**
     * Cycle to the next distinct artist matching the given single character.
     * Builds a list of distinct matching artists from filteredTracks and advances
     * through them, wrapping around at the end.
     * @param {string} char - Single lowercase character to match
     */
    cycleToNextArtist(char) {
      const tracks = this.library.filteredTracks;

      // Build ordered list of distinct matching artists (first occurrence order)
      const seen = new Set();
      const matchingArtists = [];
      for (const track of tracks) {
        if (!track.artist) continue;
        const artist = track.artist.toLowerCase();
        const stripped = this.stripIgnoredPrefix(artist);
        if (
          (stripped.startsWith(char) || artist.startsWith(char)) &&
          !seen.has(track.artist)
        ) {
          seen.add(track.artist);
          matchingArtists.push(track.artist);
        }
      }

      if (matchingArtists.length === 0) return;

      // Advance cycle index (initialize on first cycle after a fresh letter press)
      if (this._cycleChar !== char) {
        this._cycleChar = char;
        this._cycleIndex = 0; // First press already jumped to index 0
      }
      this._cycleIndex = (this._cycleIndex + 1) % matchingArtists.length;

      // Find first track by the target artist and select it
      const targetArtist = matchingArtists[this._cycleIndex];
      const targetTrack = tracks.find((t) => t.artist === targetArtist);
      if (targetTrack) {
        this.selectedTracks.clear();
        this.selectedTracks.add(targetTrack.id);
        this.scrollToTrack(targetTrack.id);
      }
    },

    /**
     * Reset the type-to-jump debounce timer
     */
    resetTypeDebounce() {
      if (this._typeDebounceTimer) {
        clearTimeout(this._typeDebounceTimer);
      }
      this._typeDebounceTimer = setTimeout(() => {
        this._typeBuffer = '';
        this._cycleChar = '';
        this._cycleIndex = -1;
        this._typeDebounceTimer = null;
      }, 500); // 500ms matches existing debounce patterns in codebase
    },
  };
}
