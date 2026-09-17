import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/ui-*.test.ts',
      'tests/electron-mounted-workflows.test.ts',
      'tests/electron-window-controls.test.ts',
      'tests/vscode-webview.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage/ux',
      include: ['src/ui/**/*.ts', 'src/electron/window-controls.ts'],
      exclude: ['src/ui/monaco.ts'],
      thresholds: {
        statements: 68,
        branches: 61,
        functions: 71,
        lines: 73,
      },
    },
  },
});
