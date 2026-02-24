import { api } from '../api.js';

/**
 * Handle double-click play with background queue building.
 * Starts playback immediately on the clicked track, then builds the full
 * queue in the background for seamless continuation.
 *
 * @param {Object} ctx - Component context (must have queue, player, _buildQueueGeneration)
 * @param {Object} track - Track to play immediately
 * @param {Array} allTracks - Full track list for queue
 * @param {number} index - Index of clicked track in allTracks
 * @param {string} logPrefix - Log prefix for error messages
 * @param {Object} [options] - Optional hooks
 * @param {Function} [options.beforePlay] - Called before play starts (e.g. to push history)
 */
export async function handleDoubleClickPlay(ctx, track, allTracks, index, logPrefix, options) {
  ctx.queue._updating = true;
  ctx._buildQueueGeneration++;
  const generation = ctx._buildQueueGeneration;
  let backgroundBuildStarted = false;

  try {
    if (ctx.queue.shuffle) {
      await _handleShufflePlay(ctx, track, allTracks, index);
    } else if (index >= 0 && index < allTracks.length) {
      backgroundBuildStarted = true;
      if (options?.beforePlay) options.beforePlay();
      await _handleSequentialPlay(ctx, track, allTracks, index, generation, logPrefix);
    } else {
      await ctx.player.playTrack(track);
    }
  } finally {
    if (!backgroundBuildStarted) {
      setTimeout(() => {
        ctx.queue._updating = false;
      }, 200);
    }
  }
}

async function _handleShufflePlay(ctx, track, allTracks, index) {
  await ctx.queue.clear();
  await ctx.queue.add(allTracks, false);
  if (index >= 0 && index < ctx.queue.items.length) {
    ctx.queue.currentIndex = index;
    ctx.queue._shuffleItems();
    await ctx.queue._syncQueueToBackend();
    await ctx.queue.playIndex(0);
  } else {
    await ctx.player.playTrack(track);
  }
}

async function _handleSequentialPlay(ctx, track, allTracks, index, generation, logPrefix) {
  // Start playback immediately with just the clicked track
  ctx.queue.items.splice(0, ctx.queue.items.length, track);
  ctx.queue._originalOrder.splice(0, ctx.queue._originalOrder.length, track);
  ctx.queue.currentIndex = 0;
  ctx.queue._playHistory = [];
  ctx.queue._playNextOffset = 0;
  await ctx.player.playTrack(track);

  // Build full queue in background
  const buildQueue = async () => {
    try {
      await api.queue.clear();
      if (ctx._buildQueueGeneration !== generation) return;

      const subsequent = allTracks.slice(index);
      const preceding = allTracks.slice(0, index);
      const fullQueue = [...subsequent, ...preceding];

      if (ctx._buildQueueGeneration !== generation) return;

      ctx.queue.items.splice(0, ctx.queue.items.length, ...fullQueue);
      ctx.queue._originalOrder.splice(0, ctx.queue._originalOrder.length, ...fullQueue);
      ctx.queue.currentIndex = 0;

      await api.queue.add(fullQueue.map((t) => t.id));
      if (ctx._buildQueueGeneration !== generation) return;

      await api.queue.setCurrentIndex(0);
    } catch (err) {
      if (ctx._buildQueueGeneration === generation) {
        console.error(`[${logPrefix}] Failed to build queue:`, err);
      }
    } finally {
      if (ctx._buildQueueGeneration === generation) {
        setTimeout(() => {
          ctx.queue._updating = false;
        }, 200);
      }
    }
  };
  buildQueue();
}
