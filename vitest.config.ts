import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

// Helper to handle file URLs for ESM
const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',  // Use node environment for API testing
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000, // 30 seconds timeout for tests
    coverage: {
      provider: 'v8',  // Use V8's built-in coverage
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        '**/types.ts',
        '**/index.ts',
      ],
    },
    // Mocking strategy (if needed)
    // mockReset: true,
  },
  resolve: {
    alias: {
      // Add any path aliases used in your project
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
