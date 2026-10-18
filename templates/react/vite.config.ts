import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const projectDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * Injects the build-time manifest.json as the single inline manifest script
 * required by the V1 single-file package format (PRD §8.2.3). The same script
 * is emitted by `dsh-game build` for the vanilla template.
 */
function dshGameManifestPlugin(): Plugin {
  return {
    name: 'dsh-game-manifest',
    transformIndexHtml(html) {
      if (/id\s*=\s*["']dsh-game-manifest["']/.test(html)) {
        throw new Error('index.html already contains a dsh-game-manifest script');
      }
      const manifest = JSON.parse(readFileSync(`${projectDir}manifest.json`, 'utf8'));
      const tag = `<script type="application/json" id="dsh-game-manifest">\n${JSON.stringify(
        manifest,
        null,
        2
      )}\n</script>`;
      return html.replace('</head>', `${tag}\n</head>`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), dshGameManifestPlugin(), viteSingleFile()],
  build: {
    target: 'es2020',
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 20 * 1024 * 1024,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
