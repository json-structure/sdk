import { defineConfig } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(import.meta.url), '..');
const outputFile = resolve(projectRoot, '../vscode/media/editor/editor.iife.js');

export default defineConfig({
  plugins: [{
    name: 'strip-generated-trailing-whitespace',
    async closeBundle() {
      const source = await readFile(outputFile, 'utf8');
      await writeFile(outputFile, source.replace(/[ \t]+$/gm, ''), 'utf8');
    }
  }],
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