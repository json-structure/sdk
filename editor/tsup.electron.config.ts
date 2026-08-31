import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/electron/main.ts', 'src/electron/preload.ts'],
  format: ['cjs'],
  outDir: 'dist-electron',
  clean: true,
  sourcemap: true,
  splitting: false,
  external: ['electron'],
});