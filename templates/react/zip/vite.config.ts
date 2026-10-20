import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * asset-zip-v2 React build (V1.5-CONTRACTS §1.5).
 *
 * The package is NOT single-file/inline: `base: './'` keeps every emitted URL
 * relative so the resource origin serves `assets/*.js|css` next to the entry
 * document. The manifest is `game.json`, written by the CLI finalize step, so
 * this config must not inject an inline manifest script.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2020',
    modulePreload: { polyfill: false },
    sourcemap: false,
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        // Deterministic file names (no content hash churn across rebuilds).
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
        inlineDynamicImports: true,
      },
    },
  },
});
