/**
 * Main content area component.
 *
 * Handles the browser-level drag-drop overlay state for the main content region.
 * Tauri's native drag-drop handler (registered in main.js) performs the actual
 * file import; this component only manages the visual feedback overlay.
 */

export function createMainContent(Alpine) {
  Alpine.data('mainContent', () => ({
    isDragging: false,

    handleDragOver() {
      this.isDragging = true;
    },

    handleDragLeave() {
      this.isDragging = false;
    },

    handleDrop(event) {
      this.isDragging = false;
      window.handleFileDrop(event);
    },
  }));
}
