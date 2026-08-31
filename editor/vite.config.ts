import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(import.meta.url), '..');

export default defineConfig({
  base: './',
  root: resolve(projectRoot, 'src/ui'),
  build: {
    outDir: resolve(projectRoot, 'dist/renderer'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});