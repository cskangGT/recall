import { defineConfig } from '@playwright/test';

/**
 * `reuseExistingServer` plus a hardcoded port means a checkout can silently
 * test *another* checkout's dev server — the tests pass or fail against code
 * you never wrote. RECALL_PORT lets a worktree claim its own port.
 */
const PORT = Number(process.env.RECALL_PORT ?? 5173);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    viewport: { width: 1512, height: 982 },
    baseURL: `http://localhost:${PORT}`,
    /*
     * Pinned, because the app now speaks the viewer's language: a Seoul clock
     * defaults it to Korean, and this suite asserts the English copy. Tests on
     * a Korean machine must see the same app as tests anywhere else; the
     * Korean surface is exercised through `?lang=ko` on purpose.
     */
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
