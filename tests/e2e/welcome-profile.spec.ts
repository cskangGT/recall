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

  // One answer at a time: picking links then shots leaves only shots chosen.
  await page.getByTestId('profile-links').click();
  await page.getByTestId('profile-shots').click();
  await expect(page.getByTestId('profile-shots')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('profile-links')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('profile-confirm').click();

  const doors = page.getByTestId('welcome-doors');
  await expect(doors).toBeVisible();
  await expect(doors.getByTestId('door-fill')).toBeVisible();
  await expect(doors.getByTestId('door-browse')).toBeVisible();
  // The diary is not an answer to 'what has been piling up?' — it waits at home.
  await expect(doors.getByTestId('door-diary')).toHaveCount(0);
  await expect(page.getByTestId('door-fill').locator('.arc__door-hint')).toContainText(
    'Screenshots piling up',
  );
  // The press is spent.
  await expect(page.getByTestId('profile-confirm')).toHaveCount(0);

  // Answered, the question steps aside — and the way back is under the door.
  await expect(page.getByTestId('welcome-profile')).toHaveCount(0);

  // Next visit: answered, so the stars are already up and the pick holds.
  await page.reload();
  await page.getByTestId('welcome').waitFor();
  await expect(page.getByTestId('welcome-doors')).toBeVisible();
  await expect(page.getByTestId('door-fill').locator('.arc__door-hint')).toContainText(
    'Screenshots piling up',
  );
  // The question folded into one line where it stood; the way back is there.
  await expect(page.getByTestId('welcome-profile-answered')).toContainText('Screenshots');
  await page.getByTestId('profile-change').click();
  await expect(page.getByTestId('welcome-profile')).toBeVisible();
  await expect(page.getByTestId('profile-shots')).toHaveAttribute('aria-checked', 'true');
});

test('answering with nothing picked still opens the doors', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('welcome').waitFor();
  await page.getByTestId('profile-confirm').click();
  await expect(page.getByTestId('welcome-doors')).toBeVisible();
  await page.getByTestId('door-browse').click();
  await expect(page.getByTestId('welcome')).toHaveCount(0);
});
