import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/** The repo root, whose .env sets the API's PORT (apps/api/src/config/env.ts, default 4000). */
const ROOT_DIR = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Libraries that rarely change get their own files, so they stay cached between builds.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          markdown: ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // In development the app calls `/v1/...` on its own origin and Vite forwards it to the API.
    proxy: {
      // ws: the integrated terminal's WebSocket goes through the same proxy. 127.0.0.1, not
      // localhost: the API listens on IPv4 only, and localhost can resolve to IPv6 first, where
      // another server on the same port (a dev server the agent started) would answer instead.
      '/v1': { target: `http://127.0.0.1:${loadEnv(mode, ROOT_DIR, '').PORT || '4000'}`, ws: true },
    },
  },
}));
