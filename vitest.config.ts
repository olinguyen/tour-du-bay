import { defineConfig } from 'vitest/config';

// Unit tests for the pure modules in src/lib; nothing here touches the DOM, so the node
// environment keeps the run fast. Kept separate from vite.config.ts so the app build
// never has to resolve the react plugin for tests.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
