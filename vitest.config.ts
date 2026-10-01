import { defineConfig } from 'vitest/config';

// Unit tests are colocated as src/**/*.test.ts (pure logic only: town, catalog, autotile, serialize).
// Browser/E2E tests live in tests/ and run under Playwright.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
