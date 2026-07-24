import { expect, type Page } from '@playwright/test';

/**
 * Signs in through the development user picker on /entrar.
 * The picker only exists outside production; these tests are a dev-only suite
 * by construction, which is also why they can exercise write flows freely.
 */
export async function signInAs(
  page: Page,
  who: 'Admin Vitalpe' | 'Gerència Vitalpe' | 'Carlos Escobar',
): Promise<void> {
  await page.goto('/entrar');
  // Already signed in from a previous test? /entrar redirects to /inici.
  if (page.url().includes('/inici')) {
    await signOut(page);
    await page.goto('/entrar');
  }
  await page.getByRole('button', { name: new RegExp(who) }).click();
  await page.waitForURL('**/inici');
}

export async function signOut(page: Page): Promise<void> {
  const sortir = page.getByRole('button', { name: 'SORTIR' });
  if (await sortir.isVisible().catch(() => false)) {
    await sortir.click();
    await page.waitForURL('**/entrar');
  }
}

/** Opens a company card by searching the master list by name. */
export async function openClient(page: Page, name: string): Promise<void> {
  await page.goto(`/clients?cerca=${encodeURIComponent(name)}`);
  await page.getByRole('link', { name, exact: false }).first().click();
  await expect(page.getByRole('heading', { name: new RegExp(name, 'i') })).toBeVisible();
}
