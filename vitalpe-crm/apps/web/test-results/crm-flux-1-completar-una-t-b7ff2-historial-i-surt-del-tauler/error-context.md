# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: crm.spec.ts >> flux 1: completar una trucada crea historial i surt del tauler
- Location: e2e/crm.spec.ts:22:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.goto: Test timeout of 60000ms exceeded.
Call log:
  - navigating to "http://localhost:3004/clients/9cd2379e-975a-4934-bb69-a368256adbff?tab=historial", waiting until "load"

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - complementary [ref=e3]:
      - link "VITALPE CRM COMERCIAL" [ref=e5] [cursor=pointer]:
        - /url: /inici
        - generic [ref=e6]: VITALPE
        - text: CRM COMERCIAL
      - navigation "Navegació principal" [ref=e7]:
        - list [ref=e8]:
          - listitem [ref=e9]:
            - link "INICI" [ref=e10] [cursor=pointer]:
              - /url: /inici
          - listitem [ref=e11]:
            - link "CLIENTS" [ref=e12] [cursor=pointer]:
              - /url: /clients
          - listitem [ref=e13]:
            - link "CALENDARI" [ref=e14] [cursor=pointer]:
              - /url: /calendari
          - listitem [ref=e15]:
            - link "TASQUES" [ref=e16] [cursor=pointer]:
              - /url: /tasques
          - listitem [ref=e17]:
            - link "REGISTRE" [ref=e18] [cursor=pointer]:
              - /url: /registre
      - generic [ref=e19]:
        - paragraph [ref=e20]: Carlos Escobar
        - paragraph [ref=e21]: carlos.escobar@vitalpe.local
        - generic [ref=e22]:
          - generic [ref=e23]: COMERCIAL
          - button "SORTIR" [ref=e25] [cursor=pointer]
    - generic [ref=e26]:
      - banner [ref=e27]:
        - button "Cerca global" [ref=e28] [cursor=pointer]:
          - generic [ref=e29]: Cerca empresa, contacte, telèfon…
          - generic [ref=e30]: ⌘K
      - main [ref=e31]:
        - generic [ref=e32]:
          - paragraph [ref=e33]:
            - link "CLIENTS" [ref=e34] [cursor=pointer]:
              - /url: /clients
            - generic [ref=e35]: / CASANOVAS ROIG MARIA
          - generic [ref=e36]:
            - generic [ref=e37]:
              - generic [ref=e38]:
                - heading "CASANOVAS ROIG MARIA" [level=1] [ref=e39]
                - paragraph [ref=e40]: Sant Jaume Sesoliveres · Catalunya · Barcelona
                - paragraph [ref=e41]: "Àlies: CASANOVAS ROIG MARIA · MARIA CASANOVAS I ROIG S.L"
              - generic [ref=e42]:
                - generic [ref=e43]: "PROPOSTA: POTENCIAL INTERESSAT"
                - generic [ref=e44]: PENDENT DE VERIFICAR
                - generic [ref=e45]: PENDENT DE GEOLOCALITZAR
                - generic [ref=e46]: CAVA
            - generic [ref=e47]:
              - generic [ref=e48]:
                - term [ref=e49]: CONTACTE PRINCIPAL
                - definition [ref=e50]:
                  - text: —
                  - link "+34938910812" [ref=e51] [cursor=pointer]:
                    - /url: tel:+34938910812
                  - link "mariacasanovas@brutnature.com" [ref=e52] [cursor=pointer]:
                    - /url: mailto:mariacasanovas@brutnature.com
              - generic [ref=e53]:
                - term [ref=e54]: COMERCIAL
                - definition [ref=e55]: Carlos Escobar
              - generic [ref=e56]:
                - term [ref=e57]: PROPERA VISITA
                - definition [ref=e58]: CAP
              - generic [ref=e59]:
                - term [ref=e60]: TASQUES PENDENTS
                - definition [ref=e61]: "0"
              - generic [ref=e62]:
                - term [ref=e63]: ÚLTIMA VERIFICACIÓ
                - definition [ref=e64]: MAI
            - generic [ref=e65]:
              - link "TRUCAR" [ref=e66] [cursor=pointer]:
                - /url: tel:+34938910812
              - link "ENVIAR CORREU" [ref=e67] [cursor=pointer]:
                - /url: mailto:mariacasanovas@brutnature.com
              - button "REGISTRAR VISITA" [ref=e68] [cursor=pointer]
              - link "GRAVAR NOTA DE VEU" [ref=e69] [cursor=pointer]:
                - /url: /registre?client=9cd2379e-975a-4934-bb69-a368256adbff
              - button "CREAR TASCA" [ref=e70] [cursor=pointer]
              - button "CREAR RECORDATORI" [ref=e71] [cursor=pointer]
              - button "AFEGIR MOSTRES" [ref=e72] [cursor=pointer]
              - button "AFEGIR OFERTA" [ref=e73] [cursor=pointer]
              - button "AFEGIR OPORTUNITAT" [ref=e74] [cursor=pointer]
              - link "EDITAR CONTACTE" [ref=e75] [cursor=pointer]:
                - /url: /clients/9cd2379e-975a-4934-bb69-a368256adbff?tab=contactes
              - link "OBRIR MAPA" [ref=e76] [cursor=pointer]:
                - /url: https://www.google.com/maps/search/?api=1&query=Montserrat%2C%20117%2C%2008770%2C%20Sant%20Jaume%20Sesoliveres%2C%20Barcelona
          - navigation "Seccions de la fitxa" [ref=e77]:
            - list [ref=e78]:
              - listitem [ref=e79]:
                - link "RESUM" [ref=e80] [cursor=pointer]:
                  - /url: /clients/9cd2379e-975a-4934-bb69-a368256adbff?tab=resum
              - listitem [ref=e81]:
                - link "CONTACTES" [ref=e82] [cursor=pointer]:
                  - /url: /clients/9cd2379e-975a-4934-bb69-a368256adbff?tab=contactes
              - listitem [ref=e83]:
                - link "UBICACIONS" [ref=e84] [cursor=pointer]:
                  - /url: /clients/9cd2379e-975a-4934-bb69-a368256adbff?tab=ubicacions
              - listitem [ref=e85]:
                - link "VINS I OPORTUNITATS" [ref=e86] [cursor=pointer]:
                  - /url: /clients/9cd2379e-975a-4934-bb69-a368256adbff?tab=oportunitats
              - listitem [ref=e87]:
                - link "HISTORIAL COMERCIAL" [ref=e88] [cursor=pointer]:
                  - /url: /clients/9cd2379e-975a-4934-bb69-a368256adbff?tab=historial
              - listitem [ref=e89]:
                - link "TASQUES" [ref=e90] [cursor=pointer]:
                  - /url: /clients/9cd2379e-975a-4934-bb69-a368256adbff?tab=tasques
              - listitem [ref=e91]:
                - link "VISITES" [ref=e92] [cursor=pointer]:
                  - /url: /clients/9cd2379e-975a-4934-bb69-a368256adbff?tab=visites
              - listitem [ref=e93]:
                - link "NOTES DE VEU" [ref=e94] [cursor=pointer]:
                  - /url: /clients/9cd2379e-975a-4934-bb69-a368256adbff?tab=veu
          - generic [ref=e95]:
            - generic [ref=e96]:
              - heading "HISTORIAL COMERCIAL (2)" [level=2] [ref=e97]
              - button "REGISTRAR ACCIÓ" [ref=e98] [cursor=pointer]
            - paragraph [ref=e99]: "L'historial no es reescriu. Per esmenar una acció, afegeix-ne una de correctiva: totes dues queden visibles."
            - list [ref=e100]:
              - listitem [ref=e101]:
                - generic [ref=e102]:
                  - generic [ref=e103]: 24/07/2026
                  - generic [ref=e104]: TRUCADA
                  - generic [ref=e105]: DEMANA PREUS
                  - generic [ref=e106]: Carlos Escobar · CRM
                - paragraph [ref=e107]: "E2E: trucada de prova, demanen tarifes."
                - button "AFEGIR ACCIÓ CORRECTIVA" [ref=e109] [cursor=pointer]
              - listitem [ref=e110]:
                - generic [ref=e111]:
                  - generic [ref=e112]: 15/06/2026
                  - generic [ref=e113]: ALTRES
                  - generic [ref=e114]: NO DETERMINAT
                  - generic [ref=e115]: Sistema · IMPORTACIO
                - paragraph [ref=e116]: "ESTAT ORIGEN: Contactado | RESULTAT ORIGEN: VACANCES FINS EL 10/07"
                - button "AFEGIR ACCIÓ CORRECTIVA" [ref=e118] [cursor=pointer]
  - button "Open Next.js Dev Tools" [ref=e124] [cursor=pointer]:
    - img [ref=e125]
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { signInAs } from './helpers';
  3   | 
  4   | /**
  5   |  * The five critical flows of the brief (§45), driven through a real browser
  6   |  * against the real imported dataset. Serial: they share mutable state.
  7   |  *
  8   |  * These are dev-suite tests by construction — they sign in through the local
  9   |  * user picker, which does not exist in production.
  10  |  */
  11  | 
  12  | test.describe.configure({ mode: 'serial' });
  13  | 
  14  | test('accés: el selector local obre sessió i SORTIR la tanca', async ({ page }) => {
  15  |   await signInAs(page, 'Carlos Escobar');
  16  |   await expect(page.getByRole('heading', { name: 'INICI' })).toBeVisible();
  17  |   await expect(page.getByText('Carlos Escobar').first()).toBeVisible();
  18  |   await page.getByRole('button', { name: 'SORTIR' }).click();
  19  |   await page.waitForURL('**/entrar');
  20  | });
  21  | 
  22  | test('flux 1: completar una trucada crea historial i surt del tauler', async ({ page }) => {
  23  |   await signInAs(page, 'Carlos Escobar');
  24  | 
  25  |   // Subject: the first pending row that has a COMPLETAR button and a client.
  26  |   const firstRow = page.locator('tbody tr').filter({ has: page.getByRole('button', { name: 'COMPLETAR' }) }).first();
  27  |   await expect(firstRow).toBeVisible();
  28  |   const clientLink = firstRow.getByRole('link').first();
  29  |   const clientHref = await clientLink.getAttribute('href');
  30  |   expect(clientHref).toMatch(/\/clients\//);
  31  | 
  32  |   await firstRow.getByRole('button', { name: 'COMPLETAR' }).click();
  33  | 
  34  |   // The completion panel demands a result before DESAR is possible.
  35  |   // .last(): the filter also matches an ancestor card that contains the panel.
  36  |   const panel = page.locator('.targeta').filter({ hasText: 'RESULTAT (obligatori)' }).last();
  37  |   await expect(panel).toBeVisible();
  38  |   await panel.getByRole('combobox').selectOption('DEMANA PREUS');
  39  |   await panel.getByRole('textbox').fill('E2E: trucada de prova, demanen tarifes.');
  40  |   await panel.getByRole('button', { name: 'DESAR' }).click();
  41  |   await expect(panel).not.toBeVisible();
  42  | 
  43  |   // The completed task must have produced an immutable history entry.
> 44  |   await page.goto(`${clientHref}?tab=historial`);
      |              ^ Error: page.goto: Test timeout of 60000ms exceeded.
  45  |   await expect(page.getByText('DEMANA PREUS').first()).toBeVisible();
  46  |   await expect(page.getByText('E2E: trucada de prova, demanen tarifes.')).toBeVisible();
  47  | });
  48  | 
  49  | test('classificació: NO POTENCIAL exigeix motiu; ACTIU SEGUR es confirma amb signatura', async ({ page }) => {
  50  |   await signInAs(page, 'Admin Vitalpe');
  51  |   await page.goto('/clients?q=CAN%20QUETU');
  52  |   await page.getByRole('link', { name: /CAN QUETU/ }).first().click();
  53  |   await page.waitForURL('**/clients/**');
  54  | 
  55  |   const block = page.locator('section, div').filter({ hasText: 'CLASSIFICACIÓ A CONFIRMAR' }).last();
  56  | 
  57  |   // Choosing NO POTENCIAL reveals a REQUIRED reason field: the form cannot even
  58  |   // be submitted without one (and the database enforces the same rule again).
  59  |   await block.getByRole('combobox').first().selectOption('NO POTENCIAL');
  60  |   const motiu = block.locator('textarea[name="reason"]');
  61  |   await expect(motiu).toBeVisible();
  62  |   await block.getByRole('button', { name: 'CONFIRMAR', exact: true }).click();
  63  |   const blockedByBrowser = await motiu.evaluate(
  64  |     (el) => !(el as HTMLTextAreaElement).checkValidity(),
  65  |   );
  66  |   expect(blockedByBrowser).toBe(true);
  67  | 
  68  |   await block.getByRole('combobox').first().selectOption('ACTIU SEGUR');
  69  |   await block.getByRole('button', { name: 'CONFIRMAR', exact: true }).click();
  70  |   await expect(block.getByText('ACTIU SEGUR').first()).toBeVisible();
  71  |   // Signed: confirmation records who and when.
  72  |   await expect(page.getByText(/Admin Vitalpe/).first()).toBeVisible();
  73  | });
  74  | 
  75  | test('registre ràpid: interpretar text produeix previsualització i confirmar aplica només el marcat', async ({ page }) => {
  76  |   await signInAs(page, 'Carlos Escobar');
  77  |   await page.goto('/registre');
  78  | 
  79  |   await page
  80  |     .getByRole('textbox')
  81  |     .last()
  82  |     .fill('He trucat a BODEGAS PINORD SA i demanen preus del base cava. Trucar el 20/10/2026 amb prioritat alta.');
  83  |   await page.getByRole('button', { name: 'INTERPRETAR', exact: true }).click();
  84  | 
  85  |   await expect(page.getByText('PREVISUALITZACIÓ — REVISA ABANS DE DESAR')).toBeVisible();
  86  |   // Nothing is saved yet: the preview is a proposal.
  87  |   await expect(page.getByRole('button', { name: 'CONFIRMAR I DESAR ELS CANVIS' })).toBeVisible();
  88  | 
  89  |   await page.getByRole('button', { name: 'CONFIRMAR I DESAR ELS CANVIS' }).click();
  90  |   await expect(page.getByText('CANVIS DESATS')).toBeVisible();
  91  | });
  92  | 
  93  | test('rls a la interfície: un COMERCIAL rebota fora de l\'administració', async ({ page }) => {
  94  |   await signInAs(page, 'Carlos Escobar');
  95  |   await page.goto('/administracio/duplicats');
  96  |   await page.waitForURL('**/inici**');
  97  |   await expect(page.getByText('No tens permisos')).toBeVisible();
  98  | });
  99  | 
  100 | test('duplicats: una decisió persisteix i la parella surt de la cua', async ({ page }) => {
  101 |   await signInAs(page, 'Admin Vitalpe');
  102 |   await page.goto('/administracio/duplicats');
  103 | 
  104 |   const counter = page.getByText(/^\d+ PENDENTS/);
  105 |   await expect(counter).toBeVisible();
  106 |   const before = Number((await counter.innerText()).match(/^(\d+)/)?.[1] ?? '0');
  107 |   test.skip(before === 0, 'cua buida');
  108 | 
  109 |   await page.getByRole('button', { name: 'MANTENIR SEPARADES' }).first().click();
  110 |   await expect(page.getByText(new RegExp(`^${before - 1} PENDENTS`))).toBeVisible();
  111 | });
  112 | 
  113 | test('exportació: el CSV filtrat baixa amb els permisos de la sessió', async ({ page }) => {
  114 |   await signInAs(page, 'Admin Vitalpe');
  115 |   const response = await page.request.get('/clients/exportacio?confirmada=ACTIU%20SEGUR');
  116 |   expect(response.status()).toBe(200);
  117 |   expect(response.headers()['content-type']).toContain('text/csv');
  118 |   const body = await response.text();
  119 |   expect(body).toContain('EMPRESA');
  120 | });
  121 | 
  122 | test('visites: crear des del calendari dona d\'alta visita i tasca vinculada', async ({ page }) => {
  123 |   await signInAs(page, 'Carlos Escobar');
  124 |   await page.goto('/calendari');
  125 |   await page.getByRole('button', { name: 'NOVA VISITA' }).click();
  126 | 
  127 |   // The company picker is the search combobox, not a select.
  128 |   const picker = page.getByRole('combobox').first();
  129 |   await picker.fill('CAN QUETU');
  130 |   await page.getByRole('option').first().click();
  131 | 
  132 |   // Tomorrow 10:00–11:00, so the visit is unmistakably upcoming.
  133 |   const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  134 |   const starts = page.locator('input[type="datetime-local"]').first();
  135 |   const ends = page.locator('input[type="datetime-local"]').nth(1);
  136 |   await starts.fill(`${tomorrow}T10:00`);
  137 |   await ends.fill(`${tomorrow}T11:00`);
  138 | 
  139 |   await page.getByRole('button', { name: /CREAR|DESAR/ }).last().click();
  140 | 
  141 |   // Visible in the calendar…
  142 |   await expect(page.getByText(/CAN QUETU/).first()).toBeVisible({ timeout: 20_000 });
  143 | 
  144 |   // …and its twin task exists — visit and task are born in one transaction.
```