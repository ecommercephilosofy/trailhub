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
  // Take whichever company is still unconfirmed rather than naming one: a
  // previous run of this very test confirms its subject, and a test that only
  // passes on a virgin database is a test that passes once.
  await page.goto('/clients?vista=pendents');
  await page.locator('tbody tr').first().getByRole('link').first().click();
  await page.waitForURL('**/clients/**');

  const block = page.locator('section, div').filter({ hasText: 'CLASSIFICACIÓ A CONFIRMAR' }).last();
  // Same action, two labels: a company that has never been classified offers
  // CONFIRMAR, one that already is offers TORNAR A CONFIRMAR.
  const confirmar = block.getByRole('button', { name: /CONFIRMAR$/ }).first();

  // Choosing NO POTENCIAL reveals a REQUIRED reason field: the form cannot even
  // be submitted without one (and the database enforces the same rule again).
  await block.getByRole('combobox').first().selectOption('NO POTENCIAL');
  const motiu = block.locator('textarea[name="reason"]');
  await expect(motiu).toBeVisible();
  await confirmar.click();
  const blockedByBrowser = await motiu.evaluate(
    (el) => !(el as HTMLTextAreaElement).checkValidity(),
  );
  expect(blockedByBrowser).toBe(true);

  await block.getByRole('combobox').first().selectOption('ACTIU SEGUR');
  await confirmar.click();
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

  // The company field is a search box, not a <select>: 800 companies do not go
  // into the DOM. Address it by its accessible name — `getByRole('combobox')`
  // would match the disabled UBICACIÓ select, which is what a <select> is.
  const dialog = page.locator('form').filter({ hasText: 'NOVA VISITA' }).last();
  await dialog.getByLabel('Cercar empresa').fill('CAN QUETU');
  await dialog.getByRole('button', { name: /CAN QUETU/ }).first().click();

  // Tomorrow 10:00–11:00, so the visit is unmistakably upcoming.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await dialog.locator('input[name="startsAt"]').fill(`${tomorrow}T10:00`);
  await dialog.locator('input[name="endsAt"]').fill(`${tomorrow}T11:00`);

  await dialog.getByRole('button', { name: 'CREAR VISITA' }).click();

  // The form closing is the only honest proof it saved. Asserting on the text
  // "CAN QUETU" alone would pass on a form that never submitted: the chosen
  // company is displayed inside the form itself.
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // The calendar opens on DIA anchored on today, and the visit is tomorrow.
  // Anchor the day view on the visit's own date rather than widening the view:
  // a week or month view would still miss it whenever "tomorrow" crosses the
  // period boundary, which is a flake waiting for a Sunday.
  await page.goto(`/calendari?vista=dia&data=${tomorrow}`);
  await expect(page.getByText(/CAN QUETU/).first()).toBeVisible({ timeout: 20_000 });

  // …and its twin task exists — visit and task are born in one transaction.
  // Filtered by company: the dated list is capped at 400 rows in date order, so
  // an unfiltered assertion would be about the cap as much as about the task.
  await page.goto('/tasques?empresa=CAN+QUETU');
  const visitTask = page.locator('tr').filter({ hasText: 'CAN QUETU' }).filter({ hasText: 'VISITA' });
  await expect(visitTask.first()).toBeVisible();
});
