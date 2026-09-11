import { DEFAULT_SORT_IGNORE_WORDS } from '../constants.js';
import { featureEnabled } from '../feature-flags.js';

/**
 * Type-to-jump mixin for library browser.
 * Handles keyboard-driven artist navigation: type a letter to jump to matching artist,
 * repeat the same letter to cycle through matching artists.
 *
 * When tracks are paginated and a match isn't found in loaded pages, falls back
 * to a backend offset lookup to jump directly to the target page.
 */
export function typeToJumpMixin() {
  return {
    // State
    _typeBuffer: '',
    _typeDebounceTimer: null,
    _cycleChar: '',
    _cycleIndex: -1,
    _jumpGen: 0,
    _isJumping: false,
    _jumpingPrefix: '',
    // jump_reliability_guard state: coalescing timer, in-flight guard,
    // pending-jump timeout, and the scroll position to restore on rollback.
    _jumpCoalesceTimer: null,
    _jumpInFlight: false,
    _jumpTimeoutTimer: null,
    _jumpRestore: null,

    /**
     * Feature flag read at call time, so toggling jump_reliability_guard at
     * runtime (ui store overrides or window.mtFeatureFlags) takes effect on
     * the next keystroke. A method rather than a getter: mixin state objects
     * are merged with Object.assign, which would evaluate an accessor here.
     * @returns {boolean}
     */
    jumpReliabilityGuard() {
      return featureEnabled('jump_reliability_guard', this.$store?.ui);
    },

    /**
     * Assign a new jump generation token. Monotonically increasing; every
     * async jump path captures the token and discards its work when a newer
     * keystroke has bumped it.
     * @returns {number} the new generation token
     */
    _nextJumpGen() {
      this._jumpGen++;
      return this._jumpGen;
    },

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

      // jump_reliability_guard: append to the buffer and coalesce the burst —
      // one jump per coalescing window, only for the final prefix. A burst
      // while a jump is still in flight is discarded: the pending jump already
      // owns the viewport and its generation stays authoritative.
      if (this.jumpReliabilityGuard()) {
        this._typeBuffer += event.key;
        this.$store.ui.typeToJumpActive = true;
        this.resetTypeDebounce();
        if (!this._isJumping) {
          this._scheduleGuardedJump();
        } else if (this._jumpCoalesceTimer) {
          clearTimeout(this._jumpCoalesceTimer);
          this._jumpCoalesceTimer = null;
        }
        return;
      }

      // Detect repeated same-letter press (cycling mode)
      // If buffer is all the same char and new char matches, cycle to next artist
      if (
        this._typeBuffer.length >= 1 &&
        ch === this._typeBuffer[0].toLowerCase() &&
        this._typeBuffer.split('').every((c) => c.toLowerCase() === ch)
      ) {
        this._typeBuffer += event.key;
        this.$store.ui.typeToJumpActive = true;
        this.cycleToNextArtist(ch);
        this.resetTypeDebounce();
        return;
      }

      // Normal mode: append to buffer and search
      this._typeBuffer += event.key;
      this._cycleChar = '';
      this._cycleIndex = -1;
      this.$store.ui.typeToJumpActive = true;
      this._executeTypeToJump(this._typeBuffer);

      // Reset debounce timer
      this.resetTypeDebounce();
    },

    /**
     * Run a fully-resolved jump for the given prefix (guard path). Bumps the
     * generation token first so any in-flight jump is invalidated before a
     * local match mutates selection or scroll.
     * @param {string} prefix
     */
    _executeTypeToJump(prefix) {
      this._nextJumpGen();
      this.jumpToMatchingArtist(prefix);
    },

    /**
     * Debounce/coalesce window for type-to-jump keystrokes (ms). A burst of
     * keys resolves once, after typing pauses, to the longest prefix typed.
     * @returns {number}
     */
    _jumpCoalesceMs() {
      const configured = this.$store.ui?.jumpCoalesceMs;
      return typeof configured === 'number' ? configured : 175;
    },

    /**
     * Schedule (or reschedule) the guarded jump for the current buffer.
     */
    _scheduleGuardedJump() {
      if (this._jumpCoalesceTimer) clearTimeout(this._jumpCoalesceTimer);
      this._jumpCoalesceTimer = setTimeout(() => {
        this._jumpCoalesceTimer = null;
        if (this._typeBuffer.length === 0) return;
        this._executeTypeToJump(this._typeBuffer);
      }, this._jumpCoalesceMs());
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
     * Falls back to backend offset lookup when match not found in loaded tracks.
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
        return;
      }

      // No match in loaded tracks — try backend offset lookup for paginated mode
      if (this.library._isPaginated() && !this.library._allPagesLoaded) {
        this._jumpViaBackend(normalizedQuery);
      } else if (this.jumpReliabilityGuard()) {
        // Nothing pending to wait for: release the in-flight guard.
        this._finishJumpSession();
      }
    },

    /**
     * Backend-assisted jump: resolve the offset, await the target page load,
     * then snap the viewport to the target row.
     * Shows a loading badge while in flight.
     * @param {string} prefix - Lowercase search prefix
     */
    async _jumpViaBackend(prefix) {
      const guard = this.jumpReliabilityGuard();
      const myGen = this._nextJumpGen();
      if (guard) this._captureJumpRestore();
      this._isJumping = true;
      this._jumpingPrefix = prefix;

      // The timeout covers the whole jump window (offset lookup + page
      // delivery): a backend that answers the lookup but never delivers the
      // page still cancels the jump and rolls back. The budget re-arms when a
      // new jump starts while one is in flight.
      if (guard) this._armJumpTimeout(myGen);

      try {
        const offset = await this.library._jumpToPrefix(prefix);
        if (myGen !== this._jumpGen) return; // superseded by a newer keystroke
        if (offset === null || offset === undefined) return;
        if (guard) this._armJumpTimeout(myGen);

        // Start the page fetch immediately after the gen check so the IPC is
        // in-flight while scrollToOffset fires (pipeline overlap).
        // _jumpToPrefix no longer calls _ensurePage, so this is the first fetch.
        const pageIndex = Math.floor(offset / this.library._pageSize);
        const pageFetch = this.library._fetchPage(pageIndex);

        // Snap to target immediately — gives instant visual feedback.
        // _isJumping badge stays visible until the page arrives.
        this.scrollToOffset(offset, myGen);

        // Await the page so rows populate before clearing the badge and selecting.
        await pageFetch;
        if (myGen !== this._jumpGen) return;

        const track = this.library.getTrackAtIndex(offset);
        if (track) {
          this.selectedTracks.clear();
          this.selectedTracks.add(track.id);
        }
      } finally {
        // Defer the flag clear to $nextTick so the shimmer branch in visibleTracks
        // stays engaged through the first re-render after the page arrives and
        // _scrollTop has synced. Without this, _isJumping flips false in the same
        // microtask as scrollToOffset, before Alpine processes the scroll update.
        //
        // Skip clearing when the library is mid-reload with totalTracks=0 — the
        // shimmer branch handles that window and visibleTracks self-extinguishes
        // _isJumping when real data arrives after the reload completes.
        if (myGen === this._jumpGen) {
          this.$nextTick(() => {
            if (myGen !== this._jumpGen) return;
            if (this.library.loading && this.library.totalTracks === 0) return;
            this._isJumping = false;
            this._jumpingPrefix = '';
            if (guard) this._finishJumpSession();
          });
        } else if (guard) {
          // Superseded exit: only the newest generation may tear down the
          // shared jump session state.
          this._finishJumpSession();
        }
      }
    },

    /**
     * Remember the pre-jump scroll state so a timed-out jump can restore it.
     * Not overwritten while a jump session is already active (the restore
     * anchor belongs to the first jump of the session).
     */
    _captureJumpRestore() {
      if (this._jumpInFlight) return this._jumpRestore;
      this._jumpInFlight = true;
      this._jumpRestore = {
        scrollTop: this._scrollTop ?? 0,
        selectedIds: this.selectedTracks ? new Set(this.selectedTracks) : new Set(),
      };
      return this._jumpRestore;
    },

    /**
     * Single authoritative finalization path for the guard: clears the
     * in-flight guard, the coalescing/timeout timers, and the restore anchor.
     */
    _finishJumpSession() {
      this._jumpInFlight = false;
      this._jumpRestore = null;
      if (this._jumpTimeoutTimer) {
        clearTimeout(this._jumpTimeoutTimer);
        this._jumpTimeoutTimer = null;
      }
      if (this._jumpCoalesceTimer) {
        clearTimeout(this._jumpCoalesceTimer);
        this._jumpCoalesceTimer = null;
      }
    },

    /**
     * Backend timeout budget for a guarded jump (ms). Non-blocking: on expiry
     * the jump is cancelled and the previous scroll/selection restored.
     * @returns {number}
     */
    _jumpBackendTimeoutMs() {
      const configured = this.$store.ui?.jumpBackendTimeoutMs;
      return typeof configured === 'number' ? configured : 3000;
    },

    /**
     * Arm the timeout fallback for generation `gen`. Runs from jump start so
     * a backend lookup that never resolves still cancels the jump.
     * @param {number} gen
     */
    _armJumpTimeout(gen) {
      if (this._jumpTimeoutTimer) clearTimeout(this._jumpTimeoutTimer);
      this._jumpTimeoutTimer = setTimeout(() => {
        this._jumpTimeoutTimer = null;
        this._cancelJumpOnTimeout(gen);
      }, this._jumpBackendTimeoutMs());
    },

    /**
     * Timeout fallback: cancel generation `gen`, restore the pre-jump scroll
     * position and selection, and clear the jump state.
     * @param {number} gen
     */
    _cancelJumpOnTimeout(gen) {
      if (gen !== this._jumpGen || !this._isJumping) return;
      const restore = this._jumpRestore;
      // Bump the generation first: any $nextTick finalize still queued for
      // this jump checks its token and stands down, leaving the rollback as
      // the single authoritative finalization for this jump.
      this._nextJumpGen();
      this._isJumping = false;
      this._jumpingPrefix = '';
      this._finishJumpSession();
      if (restore) {
        const rowHeight = this._rowHeight || 1;
        // Explicit null generation: the jump's gen was just discarded, and
        // the restore write must be authoritative.
        this._scrollToRowIndex(
          Math.round(restore.scrollTop / rowHeight),
          false,
          null,
        );
        if (this.selectedTracks) {
          this.selectedTracks = restore.selectedIds;
        }
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

      if (matchingArtists.length === 0) {
        // No match in loaded tracks — try backend for paginated mode
        if (this.library._isPaginated() && !this.library._allPagesLoaded) {
          this._jumpViaBackend(char);
        } else if (this.jumpReliabilityGuard()) {
          this._finishJumpSession();
        }
        return;
      }

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
        this.$store.ui.typeToJumpActive = false;
        // Guard: the idle window ended without a jump being scheduled; drop
        // any pending coalesce so a stale buffer can never fire a late jump.
        if (this._jumpCoalesceTimer && !this._jumpInFlight) {
          clearTimeout(this._jumpCoalesceTimer);
          this._jumpCoalesceTimer = null;
        }
      }, 1500);
    },
  };
}
