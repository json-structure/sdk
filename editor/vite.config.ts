import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(import.meta.url), '..');

export default defineConfig({
  root: resolve(projectRoot, 'src/ui'),
  build: {
    outDir: resolve(projectRoot, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});