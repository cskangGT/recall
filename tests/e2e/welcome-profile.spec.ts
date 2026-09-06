import { test, expect } from '@playwright/test';

/**
 * The sixty-second question (onboarding wow D), answered with a press: pick
 * what piles up, press 확인, and the doors — the stars — rise. Before the
 * press there are no doors; the pick re-words the fill door's promise; the
 * answer survives a reload so the stars are simply there next time.
 */

test('the stars rise only after the question is answered, worded by the pick', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome').waitFor();

  // No doors yet — the answer opens them.
  await expect(page.getByTestId('welcome-doors')).toHaveCount(0);

  await page.getByTestId('profile-shots').click();
  await expect(page.getByTestId('profile-shots')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('profile-confirm').click();

  const doors = page.getByTestId('welcome-doors');
  await expect(doors).toBeVisible();
  await expect(doors.getByTestId('door-fill')).toBeVisible();
  await expect(doors.getByTestId('door-browse')).toBeVisible();
  await expect(doors.getByTestId('door-diary')).toBeVisible();
  await expect(page.getByTestId('door-fill').locator('.arc__door-hint')).toContainText(
    'a few of those screenshots',
  );
  // The press is spent.
  await expect(page.getByTestId('profile-confirm')).toHaveCount(0);

  // Next visit: answered, so the stars are already up and the pick holds.
  await page.reload();
  await page.getByTestId('welcome').waitFor();
  await expect(page.getByTestId('welcome-doors')).toBeVisible();
  await expect(page.getByTestId('profile-shots')).toHaveAttribute('aria-pressed', 'true');
});

test('answering with nothing picked still opens the doors', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome').waitFor();
  await page.getByTestId('profile-confirm').click();
  await expect(page.getByTestId('welcome-doors')).toBeVisible();
  await page.getByTestId('door-browse').click();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
});
