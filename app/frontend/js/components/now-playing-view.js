/**
 * Now Playing View component
 *
 * Uses Alpine.js Sort plugin for queue reordering.
 * The x-sort directive handles all drag state and animations.
 */
export function createNowPlayingView(Alpine) {
  Alpine.data('nowPlayingView', () => ({
    /**
     * Handler for Sort plugin queue reordering
     * Called when user completes a drag-drop operation
     *
     * @param {string|number} itemKey - The x-sort:item value (originalIndex) of dragged item
     * @param {number} newPosition - New display position (0-indexed)
     */
    handleReorder(itemKey, newPosition) {
      const queue = this.$store.queue;
      const playOrderItems = queue.playOrderItems;

      // itemKey is the originalIndex from x-sort:item
      const fromOriginalIdx = parseInt(itemKey, 10);

      // Find the current display position of the dragged item
      const fromDisplayIdx = playOrderItems.findIndex(
        (item) => item.originalIndex === fromOriginalIdx
      );

      if (fromDisplayIdx === -1 || fromDisplayIdx === newPosition) {
        return; // Item not found or no movement
      }

      // Calculate target originalIndex based on display positions
      let toOriginalIdx;

      if (newPosition >= playOrderItems.length) {
        // Dropped past the end - use last item's originalIndex
        const lastItem = playOrderItems[playOrderItems.length - 1];
        toOriginalIdx = lastItem.originalIndex;
        // If moving forward, add 1 to go after the last item
        if (fromOriginalIdx < toOriginalIdx) {
          toOriginalIdx++;
        }
      } else {
        // Get the originalIndex of item currently at target display position
        toOriginalIdx = playOrderItems[newPosition].originalIndex;
      }

      // Avoid no-op
      if (fromOriginalIdx === toOriginalIdx) {
        return;
      }

      // Call queue's reorder method (handles currentIndex adjustment and persistence)
      queue.reorder(fromOriginalIdx, toOriginalIdx);
    },
  }));
}

export default createNowPlayingView;
