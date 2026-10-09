import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
