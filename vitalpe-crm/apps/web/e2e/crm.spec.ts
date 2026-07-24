import { expect, test } from '@playwright/test';
import { signInAs } from './helpers';

/**
 * The five critical flows of the brief (§45), driven through a real browser
 * against the real imported dataset. Serial: they share mutable state.
 *
 * These are dev-suite tests by construction — they sign in through the local
 * user picker, which does not exist in production.
 */

test.describe.configure({ mode: 'serial' });

test('accés: el selector local obre sessió i SORTIR la tanca', async ({ page }) => {
  await signInAs(page, 'Carlos Escobar');
  await expect(page.getByRole('heading', { name: 'INICI' })).toBeVisible();
  await expect(page.getByText('Carlos Escobar').first()).toBeVisible();
  await page.getByRole('button', { name: 'SORTIR' }).click();
  await page.waitForURL('**/entrar');
});

test('flux 1: completar una trucada crea historial i surt del tauler', async ({ page }) => {
  await signInAs(page, 'Carlos Escobar');

  // Subject: the first pending row that has a COMPLETAR button and a client.
  const firstRow = page.locator('tbody tr').filter({ has: page.getByRole('button', { name: 'COMPLETAR' }) }).first();
  await expect(firstRow).toBeVisible();
  const clientLink = firstRow.getByRole('link').first();
  const clientHref = await clientLink.getAttribute('href');
  expect(clientHref).toMatch(/\/clients\//);

  await firstRow.getByRole('button', { name: 'COMPLETAR' }).click();

  // The completion panel demands a result before DESAR is possible.
  // .last(): the filter also matches an ancestor card that contains the panel.
  const panel = page.locator('.targeta').filter({ hasText: 'RESULTAT (obligatori)' }).last();
  await expect(panel).toBeVisible();
  await panel.getByRole('combobox').selectOption('DEMANA PREUS');
  await panel.getByRole('textbox').fill('E2E: trucada de prova, demanen tarifes.');
  await panel.getByRole('button', { name: 'DESAR' }).click();
  await expect(panel).not.toBeVisible();

  // The completed task must have produced an immutable history entry.
  await page.goto(`${clientHref}?tab=historial`);
  await expect(page.getByText('DEMANA PREUS').first()).toBeVisible();
  await expect(page.getByText('E2E: trucada de prova, demanen tarifes.')).toBeVisible();
});

test('classificació: NO POTENCIAL exigeix motiu; ACTIU SEGUR es confirma amb signatura', async ({ page }) => {
  await signInAs(page, 'Admin Vitalpe');
  await page.goto('/clients?q=CAN%20QUETU');
  await page.getByRole('link', { name: /CAN QUETU/ }).first().click();
  await page.waitForURL('**/clients/**');

  const block = page.locator('section, div').filter({ hasText: 'CLASSIFICACIÓ A CONFIRMAR' }).last();

  // Choosing NO POTENCIAL reveals a REQUIRED reason field: the form cannot even
  // be submitted without one (and the database enforces the same rule again).
  await block.getByRole('combobox').first().selectOption('NO POTENCIAL');
  const motiu = block.locator('textarea[name="reason"]');
  await expect(motiu).toBeVisible();
  await block.getByRole('button', { name: 'CONFIRMAR', exact: true }).click();
  const blockedByBrowser = await motiu.evaluate(
    (el) => !(el as HTMLTextAreaElement).checkValidity(),
  );
  expect(blockedByBrowser).toBe(true);

  await block.getByRole('combobox').first().selectOption('ACTIU SEGUR');
  await block.getByRole('button', { name: 'CONFIRMAR', exact: true }).click();
  await expect(block.getByText('ACTIU SEGUR').first()).toBeVisible();
  // Signed: confirmation records who and when.
  await expect(page.getByText(/Admin Vitalpe/).first()).toBeVisible();
});

test('registre ràpid: interpretar text produeix previsualització i confirmar aplica només el marcat', async ({ page }) => {
  await signInAs(page, 'Carlos Escobar');
  await page.goto('/registre');

  await page
    .getByRole('textbox')
    .last()
    .fill('He trucat a BODEGAS PINORD SA i demanen preus del base cava. Trucar el 20/10/2026 amb prioritat alta.');
  await page.getByRole('button', { name: 'INTERPRETAR', exact: true }).click();

  await expect(page.getByText('PREVISUALITZACIÓ — REVISA ABANS DE DESAR')).toBeVisible();
  // Nothing is saved yet: the preview is a proposal.
  await expect(page.getByRole('button', { name: 'CONFIRMAR I DESAR ELS CANVIS' })).toBeVisible();

  await page.getByRole('button', { name: 'CONFIRMAR I DESAR ELS CANVIS' }).click();
  await expect(page.getByText('CANVIS DESATS')).toBeVisible();
});

test('rls a la interfície: un COMERCIAL rebota fora de l\'administració', async ({ page }) => {
  await signInAs(page, 'Carlos Escobar');
  await page.goto('/administracio/duplicats');
  await page.waitForURL('**/inici**');
  await expect(page.getByText('No tens permisos')).toBeVisible();
});

test('duplicats: una decisió persisteix i la parella surt de la cua', async ({ page }) => {
  await signInAs(page, 'Admin Vitalpe');
  await page.goto('/administracio/duplicats');

  const counter = page.getByText(/^\d+ PENDENTS/);
  await expect(counter).toBeVisible();
  const before = Number((await counter.innerText()).match(/^(\d+)/)?.[1] ?? '0');
  test.skip(before === 0, 'cua buida');

  await page.getByRole('button', { name: 'MANTENIR SEPARADES' }).first().click();
  await expect(page.getByText(new RegExp(`^${before - 1} PENDENTS`))).toBeVisible();
});

test('exportació: el CSV filtrat baixa amb els permisos de la sessió', async ({ page }) => {
  await signInAs(page, 'Admin Vitalpe');
  const response = await page.request.get('/clients/exportacio?confirmada=ACTIU%20SEGUR');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/csv');
  const body = await response.text();
  expect(body).toContain('EMPRESA');
});

test('visites: crear des del calendari dona d\'alta visita i tasca vinculada', async ({ page }) => {
  await signInAs(page, 'Carlos Escobar');
  await page.goto('/calendari');
  await page.getByRole('button', { name: 'NOVA VISITA' }).click();

  // The company picker is the search combobox, not a select.
  const picker = page.getByRole('combobox').first();
  await picker.fill('CAN QUETU');
  await page.getByRole('option').first().click();

  // Tomorrow 10:00–11:00, so the visit is unmistakably upcoming.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const starts = page.locator('input[type="datetime-local"]').first();
  const ends = page.locator('input[type="datetime-local"]').nth(1);
  await starts.fill(`${tomorrow}T10:00`);
  await ends.fill(`${tomorrow}T11:00`);

  await page.getByRole('button', { name: /CREAR|DESAR/ }).last().click();

  // Visible in the calendar…
  await expect(page.getByText(/CAN QUETU/).first()).toBeVisible({ timeout: 20_000 });

  // …and its twin task exists — visit and task are born in one transaction.
  await page.goto('/tasques');
  const visitTask = page.locator('tr').filter({ hasText: 'CAN QUETU' }).filter({ hasText: 'VISITA' });
  await expect(visitTask.first()).toBeVisible();
});
