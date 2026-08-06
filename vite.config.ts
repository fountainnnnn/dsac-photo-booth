import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // The booth is reached over a Cloudflare quick tunnel, whose hostname is
    // random and changes every run. Vite's host check would reject each new
    // one, so trust the whole quick-tunnel suffix rather than chasing names.
    allowedHosts: ['.trycloudflare.com'],
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    // The booth is reached over a Cloudflare quick tunnel, whose hostname is
    // random and changes every run. Vite's host check would reject each new
    // one, so trust the whole quick-tunnel suffix rather than chasing names.
    allowedHosts: ['.trycloudflare.com'],
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
