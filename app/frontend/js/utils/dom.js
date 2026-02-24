/**
 * DOM utility functions shared across components.
 */

/**
 * Check if user is currently typing in an input field
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function isTypingInInput(event) {
  const tagName = event.target.tagName;
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    event.target.isContentEditable
  );
}

/**
 * Measure the rendered width of text using a canvas context
 * @param {string} text - Text to measure
 * @param {HTMLElement} element - Element whose computed font style is used
 * @returns {number} Width in pixels
 */
export function measureTextWidth(text, element) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const style = window.getComputedStyle(element);
  context.font = `${style.fontSize} ${style.fontFamily}`;
  return context.measureText(text).width;
}
