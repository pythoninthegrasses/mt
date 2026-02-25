/**
 * Backend API Client
 *
 * This file re-exports from domain modules for backward compatibility.
 * New code should import directly from domain modules:
 *   import { library } from './api/library.js';
 *   import { playlists } from './api/playlists.js';
 */

export { api, ApiError } from './api/index.js';
export { api as default } from './api/index.js';
