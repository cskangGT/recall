import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Meetings — the calendar laid out by day, with what Mado remembers attached.
 *
 * The server is mocked at the route level: the contract (capabilities, the
 * Google status, the meetings window) is what these tests pin, and the seed
 * graph is served from the committed file so the cited memory is a real one.
 * Seed mode has no calendar door at all, and the first test says so.
 */

const seed = readFileSync(path.join(process.cwd(), 'seed/workspace.json'), 'utf8');

const HOUR = 3600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const me = { name: 'Me', email: 'me@example.com', self: true, organizer: false };
const sujin = { name: '김수진', email: 'sujin@example.com', self: false, organizer: true };
const jun = { name: '박준', email: 'jun@example.com', self: false, organizer: false };

/**
 * Three meetings: one running right now (so it is today's whatever the hour —
 * the browser's clock is New York while the runner's may not be), one at
 * this time tomorrow, one three days ago.
 */
function fixture(connected: boolean) {
  return {
    connected,
    email: connected ? 'me@example.com' : null,
    syncedAt: connected ? iso(-5 * 60_000) : null,
    reason: null,
    from: iso(-7 * 24 * HOUR),
    to: iso(14 * 24 * HOUR),
    meetings: connected
      ? [
          {
            id: 'evt_past',
            title: 'Retro with the platform team',
            startsAt: iso(-72 * HOUR),
            endsAt: iso(-71 * HOUR),
            allDay: false,
            location: null,
            description: null,
            meetLink: null,
            htmlLink: 'https://calendar.google.com/event?eid=past',
            attendees: [me, jun],
            context: [],
          },
          {
            id: 'evt_tomorrow',
            title: 'Design review',
            startsAt: iso(24 * HOUR),
            endsAt: iso(25 * HOUR),
            allDay: false,
            location: null,
            description: null,
            meetLink: 'https://meet.google.com/abc-defg-hij',
            htmlLink: 'https://calendar.google.com/event?eid=tomorrow',
            attendees: [me, jun],
            context: [],
          },
          {
            id: 'evt_today',
            title: 'Seed round — second meeting',
            startsAt: iso(-5 * 60_000),
            endsAt: iso(55 * 60_000),
            allDay: false,
            location: null,
            description: null,
            meetLink: 'https://meet.google.com/xyz-1234-abc',
            htmlLink: 'https://calendar.google.com/event?eid=today',
            attendees: [jun, me, sujin],
            context: [
              {
                memory_id: 'mem_00',
                source_id: 'src_seed_deck_notes',
                text: 'Seed funds decide within two meetings, so the second meeting is the real one',
                category_name: 'Investor Notes',
                source_title: 'Notes from seed fundraising prep',
                source_type: 'text',
              },
            ],
          },
        ]
      : [],
  };
}

/** A server with a Google client; `connected` flips when the connect door is used. */
async function mockServer(page: Page, state: { connected: boolean; google: boolean }) {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 404, json: { error: `not mocked: ${route.request().url()}` } }),
  );
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ json: { appleNotes: false, notion: false, condense: false, google: state.google } }),
  );
  await page.route('**/api/workspaces/*/graph', (route) =>
    route.fulfill({ contentType: 'application/json', body: seed }),
  );
  await page.route('**/api/workspaces/*/google', (route) =>
    route.fulfill({
      json: { configured: true, connected: state.connected, email: state.connected ? 'me@example.com' : null },
    }),
  );
  await page.route('**/api/workspaces/*/google/connect', (route) => {
    state.connected = true;
    return route.fulfill({ json: { url: '/?api=1&skipWelcome=1&google=connected' } });
  });
  await page.route('**/api/workspaces/*/google/disconnect', (route) => {
    state.connected = false;
    return route.fulfill({ json: { disconnected: true } });
  });
  await page.route('**/api/workspaces/*/meetings*', (route) =>
    route.fulfill({ json: fixture(state.connected) }),
  );
}

test('seed mode has no calendar door, and M does nothing', async ({ page }) => {
  await page.goto('/?skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('rail-meetings')).toHaveCount(0);
  await page.keyboard.press('m');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('meetings-view')).toHaveCount(0);
});

test('the calendar lays out by day — today first, the past week last', async ({ page }) => {
  await mockServer(page, { connected: true, google: true });
  await page.goto('/?api=1&skipWelcome=1&lang=ko');
  await expect(page.getByTestId('arc-browser')).toBeVisible();

  await expect(page.getByTestId('rail-meetings')).toBeVisible();
  await expect(page.getByTestId('rail-meetings').locator('.rail__label')).toHaveText('미팅');
  await page.keyboard.press('m');
  await expect(page.getByTestId('meetings-view')).toBeVisible();
  await expect(page.getByTestId('rail-meetings')).toHaveAttribute('aria-current', 'page');

  await expect(page.locator('.meetings__eyebrow')).toHaveText(['오늘', '내일', '지난 일주일']);
  await expect(page.getByTestId('meetings-synced')).toContainText('기준');

  // The organizer comes first and the self is never named.
  await expect(page.getByTestId('meeting-evt_today-who')).toHaveText('나 + 김수진, 박준');
  await expect(page.getByTestId('meeting-evt_today').getByRole('link')).toHaveAttribute(
    'href',
    'https://meet.google.com/xyz-1234-abc',
  );

  // Home says the day first: the briefing's own block is the door, and no
  // card above it repeats the same meeting.
  await page.getByTestId('rail-tree').click();
  await expect(page.getByTestId('morning-meetings')).toHaveCount(0);
  await expect(page.getByTestId('brief-meeting-evt_today')).toContainText('김수진, 박준');
  await page.getByTestId('brief-meeting-evt_today').click();
  await expect(page.getByTestId('meetings-view')).toBeVisible();
});

test('a row opens to what Mado remembers, and the memory opens as a page', async ({ page }) => {
  await mockServer(page, { connected: true, google: true });
  await page.goto('/?api=1&skipWelcome=1&lang=ko');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.getByTestId('rail-meetings').click();

  await expect(page.getByTestId('meeting-evt_today-context')).toHaveCount(0);
  await page.getByTestId('meeting-evt_today').getByRole('button').click();
  const context = page.getByTestId('meeting-evt_today-context');
  await expect(context).toContainText('Mado가 기억하는 것');
  await expect(context.locator('.memory-row')).toHaveCount(1);
  await expect(context.locator('.memory-row')).toContainText('second meeting is the real one');

  await context.locator('.memory-row').click();
  await expect(page.getByTestId('memory-page')).toBeVisible();
  await expect(page.getByTestId('memory-page-text')).toContainText('second meeting is the real one');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('memory-page')).toHaveCount(0);

  // A row with nothing attached says so instead of showing nothing.
  await page.getByTestId('meeting-evt_tomorrow').getByRole('button').click();
  await expect(page.getByTestId('meeting-evt_tomorrow-context')).toContainText('아직 기억해 둔 게 없어요');
});

test('refresh asks the server to re-read the calendar', async ({ page }) => {
  await mockServer(page, { connected: true, google: true });
  await page.goto('/?api=1&skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByTestId('meetings-view')).toBeVisible();

  const refreshed = page.waitForRequest((r) => r.url().includes('/meetings?refresh=1'));
  await page.getByTestId('meetings-refresh').click();
  await refreshed;
  await expect(page.locator('.meetings__eyebrow')).toHaveText(['today', 'tomorrow', 'the last week']);
});

test('not connected: a quiet page with one door, and the way back through it', async ({ page }) => {
  const state = { connected: false, google: true };
  await mockServer(page, state);
  await page.goto('/?api=1&skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await page.keyboard.press('m');

  await expect(page.getByTestId('meetings-view')).toContainText('Bring your calendar here');
  await expect(page.getByTestId('meetings-connect')).toBeVisible();

  // Settings says the same thing in its own row.
  await page.keyboard.press(',');
  await expect(page.getByTestId('settings-google-status')).toHaveText('not connected');
  await expect(page.getByTestId('settings-google')).toHaveText('Connect');
  await page.keyboard.press('Escape');

  // The door: the mock's "Google" sends the browser straight back connected.
  await page.getByTestId('meetings-connect').click();
  await expect(page.getByTestId('toast')).toContainText('Google Calendar is connected.');
  await expect(page.getByTestId('meetings-view')).toBeVisible();
  await expect(page.getByTestId('meeting-evt_today')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('google')).toBeNull();

  await page.keyboard.press(',');
  await expect(page.getByTestId('settings-google-status')).toHaveText('connected as me@example.com');
  await page.getByTestId('settings-google').click();
  await expect(page.getByTestId('settings-google-status')).toHaveText('not connected');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('meetings-connect')).toBeVisible();
});

test('a server with no Google client draws no door', async ({ page }) => {
  await mockServer(page, { connected: false, google: false });
  await page.goto('/?api=1&skipWelcome=1');
  await expect(page.getByTestId('arc-browser')).toBeVisible();
  await expect(page.getByTestId('rail-meetings')).toHaveCount(0);
  await page.keyboard.press('m');
  await expect(page.getByTestId('meetings-view')).toHaveCount(0);
  await page.keyboard.press(',');
  await expect(page.getByTestId('settings-google')).toHaveCount(0);
});

/**
 * The way back from the calendar into memory: a meeting that has happened
 * takes one line, kept as an ordinary note with the meeting and the people
 * written into it — so the next meeting with them finds it by their names.
 * A meeting still ahead on another day offers no such line.
 */
test('a finished meeting keeps one line, with the people written into the original', async ({ page }) => {
  await mockServer(page, { connected: true, google: true });
  let sent: { title?: string; content?: string } | null = null;
  await page.route('**/api/workspaces/*/capture', (route) => {
    sent = route.request().postDataJSON();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ addedMemoryIds: [], reorg: null, graph: JSON.parse(seed) }),
    });
  });
  await page.goto('/?api=1&skipWelcome=1&lang=ko');
  await page.getByTestId('rail-meetings').click();

  await page.getByTestId('meeting-evt_tomorrow').getByRole('button').first().click();
  await expect(page.getByTestId('meeting-evt_tomorrow-note')).toHaveCount(0);

  await page.getByTestId('meeting-evt_past').getByRole('button').first().click();
  await page.getByTestId('meeting-evt_past-note').fill('플랫폼 팀은 배포 파이프라인을 다음 분기에 옮기기로 했다');
  await page.getByTestId('meeting-evt_past-note').press('Enter');

  await expect(page.getByTestId('toast').last()).toContainText('박준과 만날 때');
  expect(sent!.title).toBe('Retro with the platform team');
  expect(sent!.content).toContain('배포 파이프라인');
  expect(sent!.content).toContain('참석: 박준');
  await expect(page.getByTestId('meeting-evt_past-note')).toHaveValue('');
});
