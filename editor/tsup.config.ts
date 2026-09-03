import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/index.ts', 'src/ui.ts', 'src/libraries/host-runtime.ts', 'src/conversion/types.ts', 'src/host/effective-imports.ts'], format: ['esm', 'cjs'], dts: true, clean: true });
