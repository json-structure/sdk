import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/index.ts', 'src/ui.ts', 'src/libraries/host-runtime.ts'], format: ['esm', 'cjs'], dts: true, clean: true });
