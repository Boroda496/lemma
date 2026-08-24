import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/*
 * `base` is set for GitHub Pages, which serves the app from /lemma/ rather
 * than the domain root. It has to reach the PWA manifest too, or an installed
 * app launches at the wrong path and shows a 404 instead of the app.
 */
const BASE = process.env.DEPLOY_BASE ?? '/lemma/';

export default defineConfig({
  base: BASE,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      // Any unknown path inside the app resolves to the shell, so a deep link
      // or a refresh on an installed PWA does not 404.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,ttf,png}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Any unknown path inside the app resolves to the shell, so a refresh
        // on an installed PWA does not 404.
        navigateFallback: `${BASE}index.html`,
      },
      manifest: {
        name: 'Lemma',
        short_name: 'Lemma',
        description: 'Verified mathematics practice — algebra to calculus, one proven step at a time.',
        theme_color: '#0b0f14',
        background_color: '#0b0f14',
        display: 'standalone',
        orientation: 'any',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
