import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import handlebars from 'vite-plugin-handlebars';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    tailwindcss(),
    handlebars({
      partialDirectory: resolve(__dirname, 'views'),
    }),
    {
      name: 'css-hmr-fix',
      handleHotUpdate({ file, server }) {
        if (file.endsWith('.css')) {
          server.ws.send({ type: 'full-reload' });
          return [];
        }
      },
    },
  ],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  css: {
    devSourcemap: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    outDir: 'dist',
  },
});
