import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const rendererBundleFileName = 'editor.iife.js';

export function normalizeRendererBundle(source) {
  return source.replace(/[ \t]+$/gm, '');
}

export function createVscodeRendererConfig({ write = true, emptyOutDir = true } = {}) {
  return {
    plugins: [{
      name: 'strip-generated-trailing-whitespace',
      generateBundle(_options, bundle) {
        const renderer = bundle[rendererBundleFileName];
        if (!renderer || renderer.type !== 'chunk') throw new Error(`Vite did not generate ${rendererBundleFileName}.`);
        renderer.code = normalizeRendererBundle(renderer.code);
      },
    }],
    define: {
      'import.meta.url': 'self.location.href',
    },
    build: {
      lib: {
        entry: resolve(projectRoot, 'src/ui/vscode-webview.ts'),
        formats: ['iife'],
        name: 'JsonStructureEditorWebview',
        fileName: 'editor',
      },
      outDir: resolve(projectRoot, '../vscode/media/editor'),
      emptyOutDir,
      write,
    },
  };
}

export async function buildVscodeRenderer({ write = false, emptyOutDir = false } = {}) {
  const { build } = await import('vite');
  return build({ ...createVscodeRendererConfig({ write, emptyOutDir }), logLevel: 'silent' });
}
