import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // The frontend needs a DOM; the backend needs node builtins (`node:sqlite`
    // is unresolvable under jsdom). Split by directory rather than trying to
    // make one environment satisfy both.
    environment: 'jsdom',
    environmentMatchGlobs: [['tests/server/**', 'node']],
    globals: true,
    setupFiles: ['tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/server/**/*.test.ts',
    ],
  },
});
