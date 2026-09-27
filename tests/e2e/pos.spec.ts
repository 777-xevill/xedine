/**
 * ROADMAP Phase 1 "Done when": order → KDS ready → split payment → receipt print preview.
 * Drives the real till and kitchen screen against a real Supabase (CI), in English.
 */
import { expect, test, type Page } from '@playwright/test';

const stamp = Date.now().toString(36);
const password = 'test-password-1';
const ownerEmail = `pos-owner-${stamp}@e2e.xedine.example`;
const slug = `pos-${stamp}`;

async function pressPin(page: Page, pin: string) {
  for (const digit of pin) await page.getByRole('button', { name: digit, exact: true }).click();
}

test.describe.serial('a sale from till to kitchen to receipt', () => {
  test('the owner sets up a restaurant, a menu item and two PIN staff', async ({ page }) => {
    await page.goto('/sign-up');
    await page.getByLabel('Full name').fill('Till Owner');
    await page.getByLabel('Email').fill(ownerEmail);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByLabel('Restaurant name').fill('E2E Till House');
    await page.getByLabel('Web address').fill(slug);
    await page.getByLabel('Branch name').first().fill('Dhanmondi');
    await page.getByRole('button', { name: 'Create restaurant' }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}$`));

    await page.goto(`/${slug}/menu`);
    await page.getByLabel('Category name').fill('Rice');
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByText('Rice').first()).toBeVisible();
    await page.getByLabel('Item name').fill('Kacchi');
    await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Rice' });
    await page.getByLabel('Price (৳)', { exact: true }).fill('300');
    await page.getByRole('button', { name: 'Add item' }).click();
    await expect(page.getByText('Kacchi')).toBeVisible();

    await page.goto(`/${slug}/staff`);
    for (const [name, role, pin] of [
      ['Rahim', 'cashier', '1234'],
      ['Farhana', 'manager', '9999'],
    ] as const) {
      await page.getByLabel('Name', { exact: true }).fill(name);
      await page.getByLabel('Role').selectOption(role);
      await page.getByLabel('PIN (optional now)').fill(pin);
      await page.getByRole('button', { name: 'Add staff' }).click();
      await expect(page.getByTestId('staff-list').getByText(name)).toBeVisible();
    }
  });

  test('order → kitchen ready → split payment → printable receipt', async ({ page, context }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(ownerEmail);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}$`));

    // Pair this browser as the branch's till (ADR 0013), PIN in, open the shift.
    await page.goto('/pos');
    await page.getByRole('button', { name: 'Pair device' }).click();
    await page.getByRole('button', { name: 'Rahim' }).click();
    await pressPin(page, '1234');
    await page.getByLabel('Opening float').fill('500');
    await page.getByRole('button', { name: 'Open shift' }).click();

    // Ring up two Kacchi and send them to the kitchen.
    await page.getByRole('button', { name: /Kacchi/ }).click();
    await page.getByRole('button', { name: 'One more' }).click();
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('heading', { name: /Order #\d+/ })).toBeVisible();
    await page.getByRole('button', { name: 'Send to kitchen' }).click();
    await expect(page.getByRole('button', { name: 'Print KOT' })).toBeVisible();

    // The kitchen screen on the same paired device takes the ticket to ready in two taps.
    const kds = await context.newPage();
    await kds.goto('/kds');
    await expect(kds.getByText('2×')).toBeVisible();
    await kds.getByRole('button', { name: 'Start' }).click();
    await kds.getByRole('button', { name: 'Ready' }).click();
    await expect(kds.getByRole('button', { name: 'Served' })).toBeVisible();
    await kds.close();

    // Split: ৳100 by bKash, the rest in cash with a round-up note, so there is change.
    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.getByRole('button', { name: 'bKash' }).click();
    await page.getByLabel('Amount').fill('100');
    await page.getByRole('button', { name: 'Add payment' }).click();
    await expect(page.getByText(/Amount paid ৳100/)).toBeVisible();
    await page.getByRole('button', { name: 'Cash' }).click();
    await page.getByRole('button', { name: '৳1,000' }).click();

    await expect(page.getByRole('heading', { name: 'Order complete' })).toBeVisible();
    await expect(page.getByText(/Change: ৳/)).toBeVisible();
    await expect(page.getByText('Paid', { exact: true })).toBeVisible();

    // Print preview: the receipt sheet is hidden on screen and shown to the printer.
    const sheet = page.locator('.print-sheet');
    await expect(sheet).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('E2E Till House');
    await expect(sheet).toContainText('2 × Kacchi');
    await expect(sheet).toContainText('Total');
    await expect(sheet).toContainText('INV-');
  });
});
