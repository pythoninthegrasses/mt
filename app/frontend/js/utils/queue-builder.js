import { queue } from '../api/queue.js';

/**
 * Handle double-click play with atomic backend queue building.
 * Sends a single IPC command that clears the queue, installs all tracks
 * (rotated or shuffled), triggers audio playback, and returns the new state.
 *
 * @param {Object} ctx - Component context (must have queue and player stores)
 * @param {Object} track - Track to play immediately
 * @param {Array} allTracks - Full track list for queue
 * @param {number} index - Index of clicked track in allTracks
 * @param {string} logPrefix - Log prefix for error messages
 * @param {Object} [options] - Optional hooks
 * @param {Function} [options.beforePlay] - Called before play starts (e.g. to push history)
 */
export async function handleDoubleClickPlay(ctx, track, allTracks, index, logPrefix, options) {
  if (index < 0 || index >= allTracks.length || track.missing) {
    await ctx.player.playTrack(track);
    return;
  }

  ctx.queue._updating = true;

  try {
    if (options?.beforePlay) options.beforePlay();

    const trackIds = allTracks.map((t) => t.id);
    const result = await queue.playContext(trackIds, index, ctx.queue.shuffle);

    // Apply response to queue store
    ctx.queue.items = result.items.map((item) => item.track || item);
    ctx.queue.currentIndex = result.current_index;
    ctx.queue.shuffle = result.shuffle_enabled ?? ctx.queue.shuffle;

    // Update player state from the track returned by backend
    ctx.player.updateTrackState(result.track, result.duration_ms);
  } catch (err) {
    console.error(`[${logPrefix}] Failed to play context:`, err);
  } finally {
    setTimeout(() => {
      ctx.queue._updating = false;
    }, 200);
  }
}

/**
 * Handle double-click play for paginated library sections using a backend query.
 * Passes filter/sort params to the backend so it can resolve the full ordered
 * track ID list in a single DB round-trip — no frontend _loadAllPages needed.
 *
 * @param {Object} ctx - Component context (must have queue and player stores)
 * @param {Object} track - Track to play immediately
 * @param {Object} queryParams - Current library filter/sort state
 * @param {string|null} queryParams.search
 * @param {string|null} queryParams.sortBy - Backend column name (e.g. 'artist', 'added_date')
 * @param {string|null} queryParams.sortOrder - 'asc' or 'desc'
 * @param {string|null} queryParams.ignoreWords - CSV of words to strip for sort
 * @param {string} logPrefix - Log prefix for error messages
 * @param {Object} [options] - Optional hooks
 * @param {Function} [options.beforePlay] - Called before play starts
 */
export async function handleDoubleClickPlayQuery(
  ctx,
  track,
  queryParams,
  logPrefix,
  options,
) {
  if (track.missing) {
    await ctx.player.playTrack(track);
    return;
  }

  ctx.queue._updating = true;

  try {
    if (options?.beforePlay) options.beforePlay();

    const result = await queue.playContextQuery(track.id, queryParams, ctx.queue.shuffle);

    ctx.queue.items = result.items.map((item) => item.track || item);
    ctx.queue.currentIndex = result.current_index;
    ctx.queue.shuffle = result.shuffle_enabled ?? ctx.queue.shuffle;

    ctx.player.updateTrackState(result.track, result.duration_ms);
  } catch (err) {
    console.error(`[${logPrefix}] Failed to play context query:`, err);
  } finally {
    setTimeout(() => {
      ctx.queue._updating = false;
    }, 200);
  }
}
