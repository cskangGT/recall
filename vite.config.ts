import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin, so the API needs no CORS headers — a local service holding
    // a user's whole corpus should not be reachable from any page they visit.
    proxy: { '/api': { target: 'http://localhost:5174', changeOrigin: true } },
  },
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
