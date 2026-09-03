import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    // Playwright specs live in e2e/ and run under `npm run test:e2e`.
    exclude: ['node_modules', 'dist', 'e2e/**'],
  },
});
