/**
 * ROADMAP Phase 0 "Done when": an owner signs up, creates an org with branches, and invites a manager
 * limited to one branch; bn/en switching works. Drives the real UI against a real Supabase.
 */
import { expect, test, type Page } from '@playwright/test';

const stamp = Date.now().toString(36);
const password = 'test-password-1';
const ownerEmail = `owner-${stamp}@e2e.xedine.example`;
const managerEmail = `manager-${stamp}@e2e.xedine.example`;
const slug = `e2e-${stamp}`;

async function signUp(page: Page, fullName: string, email: string) {
  await page.getByLabel('Full name').fill(fullName);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
}

/**
 * Sign in and wait for the redirect to land. Navigating before it completes races the session
 * cookie: the proxy would bounce the next request straight back to /sign-in.
 */
async function signInAsOwner(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ownerEmail);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}$`));
}

test.describe.serial('owner onboarding and a one-branch manager', () => {
  let inviteLink = '';

  test('the owner signs up and creates a restaurant with two branches', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Create account' }).click();
    await signUp(page, 'Owner Test', ownerEmail);

    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByLabel('Restaurant name').fill('E2E Kacchi House');
    await page.getByLabel('Web address').fill(slug);
    await page.getByLabel('Branch name').first().fill('Dhanmondi');
    await page.getByRole('button', { name: 'Add another branch' }).click();
    await page.getByLabel('Branch name').nth(1).fill('Mirpur');
    await page.getByRole('button', { name: 'Create restaurant' }).click();

    await expect(page).toHaveURL(new RegExp(`/${slug}$`));
    await expect(page.getByTestId('org-name')).toHaveText('E2E Kacchi House');
    await expect(page.getByTestId('role')).toHaveText('Owner');
    await expect(page.getByTestId('branches')).toHaveText('All branches');
  });

  test('a duplicate web address is refused with a friendly message', async ({ page }) => {
    await signInAsOwner(page);

    await page.goto('/onboarding');
    await page.getByLabel('Restaurant name').fill('Copycat');
    await page.getByLabel('Web address').fill(slug);
    await page.getByLabel('Branch name').first().fill('Somewhere');
    await page.getByRole('button', { name: 'Create restaurant' }).click();
    await expect(page.getByText('That web address is already taken')).toBeVisible();
  });

  test('the owner invites a manager who can see only Mirpur', async ({ page }) => {
    await signInAsOwner(page);

    await page.goto(`/${slug}/team`);
    await page.getByLabel('Their email').fill(managerEmail);
    await page.getByLabel('Role').selectOption('manager');
    await page.getByLabel('Mirpur').check();
    await page.getByRole('button', { name: 'Create invitation link' }).click();

    const link = page.getByTestId('invite-link');
    await expect(link).toBeVisible();
    inviteLink = await link.inputValue();
    expect(inviteLink).toContain('/accept-invite?token=');
    await expect(page.getByText(managerEmail)).toBeVisible();
  });

  test('the manager accepts the invitation and is limited to their branch', async ({ page }) => {
    expect(inviteLink).not.toBe('');
    await page.goto(inviteLink);

    // Signed out: the invitation page itself asks for a name and a password, then they are in.
    await expect(page).toHaveURL(/\/accept-invite\?token=/);
    await page.getByLabel('Your name').fill('Manager Test');
    await page.getByLabel('Choose a password').fill(password);
    await page.getByRole('button', { name: 'Join the team' }).click();

    await expect(page).toHaveURL(new RegExp(`/${slug}$`));
    await expect(page.getByTestId('role')).toHaveText('Branch manager');
    await expect(page.getByTestId('branches')).toHaveText('Mirpur');
    await expect(page.getByText('Dhanmondi')).toHaveCount(0);

    // Owner-only pages are not even discoverable to a manager.
    await expect(page.getByRole('link', { name: 'Team' })).toHaveCount(0);
    const team = await page.goto(`/${slug}/team`);
    expect(team?.status()).toBe(404);
  });

  test('the language switches between English and Bangla and persists across pages', async ({
    page,
  }) => {
    await signInAsOwner(page);

    await page.getByRole('button', { name: 'বাংলা' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('স্বাগতম');
    await expect(page.getByTestId('role')).toHaveText('মালিক');
    await page.goto(`/${slug}/settings`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('সেটিংস');

    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  });

  test('the price basis is editable until the first order, and settings save', async ({ page }) => {
    await signInAsOwner(page);
    await page.goto(`/${slug}/settings`);

    await page.getByLabel('VAT rate (%)').fill('7.5');
    await page.getByRole('radio', { name: /Exclude VAT/ }).check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('VAT rate (%)')).toHaveValue('7.5');
    await expect(page.getByRole('radio', { name: /Exclude VAT/ })).toBeChecked();
  });
});

test.describe('signed-out access and job authentication', () => {
  test('protected pages redirect to sign-in', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fonboarding/);
  });

  test('a stranger cannot open an organization page they do not belong to', async ({ page }) => {
    await page.goto('/sign-up');
    await signUp(page, 'Stranger', `stranger-${stamp}@e2e.xedine.example`);
    await expect(page).toHaveURL(/\/onboarding/);
    const res = await page.goto(`/${slug}`);
    expect(res?.status()).toBe(404);
  });

  test('the job endpoint refuses callers without the shared secret', async ({ request }) => {
    const res = await request.post('/api/jobs/refresh_today');
    expect(res.status()).toBe(401);
    const wrong = await request.post('/api/jobs/refresh_today', {
      headers: { Authorization: 'Bearer nope' },
    });
    expect(wrong.status()).toBe(401);
  });

  test('with the secret a job runs once per period, and a repeat is a no-op', async ({
    request,
  }) => {
    const secret = process.env.JOB_SECRET;
    test.skip(!secret, 'JOB_SECRET is not configured for this run');
    const headers = { Authorization: `Bearer ${secret}` };
    const first = await request.post('/api/jobs/close_business_day', { headers });
    expect(first.status()).toBe(200);
    const again = await request.post('/api/jobs/close_business_day', { headers });
    expect((await again.json()).status).toBe('already_ran');
    const unknown = await request.post('/api/jobs/not_a_job', { headers });
    expect(unknown.status()).toBe(404);
  });
});
