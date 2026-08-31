import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(import.meta.url), '..');

export default defineConfig({
  define: {
    'import.meta.url': 'self.location.href'
  },
  build: {
    lib: {
      entry: resolve(projectRoot, 'src/ui/vscode-webview.ts'),
      formats: ['iife'],
      name: 'JsonStructureEditorWebview',
      fileName: 'editor'
    },
    outDir: resolve(projectRoot, '../vscode/media/editor'),
    emptyOutDir: true
  }
});