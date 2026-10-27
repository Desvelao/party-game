import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'bot/**/*.test.ts'],
    environment: 'node',
    // registers the games under src/games/ from source, as the server would load them from packs
    setupFiles: ['src/core/test-setup.ts'],
  },
});
