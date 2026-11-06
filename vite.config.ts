import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/map-projections/',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
