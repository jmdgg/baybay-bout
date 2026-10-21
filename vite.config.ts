import { defineConfig } from 'vite';
import { duelServer } from './server/duel-plugin';

export default defineConfig({
  // relative asset paths: the build works from any static host or sub-folder
  base: './',
  plugins: [duelServer()], // "Duel a friend": rooms over WebSocket at /duel (dev and preview)
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4188,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      // the 3D duel plus the 2D practice page (all 17 letters, teach mode) linked from the title screen
      input: { main: 'index.html', prototype: 'prototype/index.html', pad: 'pad.html' },
    },
  },
});
