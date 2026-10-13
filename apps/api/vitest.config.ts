import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'src/**/*.spec.ts',
      'scripts/**/*.spec.ts',
      'evals/**/*.spec.ts',
    ],
    globalSetup: ['./src/testing/global-setup.ts'],
    restoreMocks: true,
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
