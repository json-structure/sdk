import { defineConfig } from 'vite';
import { createVscodeRendererConfig } from './scripts/vscode-renderer-build.mjs';

export default defineConfig(createVscodeRendererConfig());
