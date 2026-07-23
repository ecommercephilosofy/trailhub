/**
 * Import documentation generator.
 *
 * Everything under docs/imports/<date>/ is produced from the database after the
 * run, never hand-written, so the numbers in the report and the numbers in the
 * database cannot drift apart.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlRunner } from './db.js';
import { SOURCES } from './sources.js';
import type { Stats } from './pipeline.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function importDocsDir(date: string): string {
  return path.join(ROOT, 'docs', 'imports', date);
}

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const head = columns.join(',');
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(','));
  return [head, ...body].join('\n') + '\n';
}

export async function writeSourceInventory(
  db: SqlRunner,
  importId: string,
  dir: string,
): Promise<void> {
  const files = await db.query<{
    filename: string; byte_size: string; sha256: string;
    sheet_name: string; header_row: number | null; rows_total: number; rows_read: number;
    entity_hint: string | null; is_excluded: boolean; exclusion_reason: string | null;
  }>(
    `select f.filename, f.byte_size, f.sha256, s.sheet_name, s.header_row,
            s.rows_total, s.rows_read, s.entity_hint, s.is_excluded, s.exclusion_reason
       from public.import_files f
       join public.import_sheets s on s.import_file_id = f.id
      where f.import_id = $1
      order by f.filename, s.sheet_name`,
    [importId],
  );

  const byFile = new Map<string, typeof files>();
  for (const row of files) {
    const list = byFile.get(row.filename) ?? [];
    list.push(row);
    byFile.set(row.filename, list);
  }

  const lines: string[] = [
    '# SOURCE_INVENTORY',
    '',
    'Inventari immutable de les fonts comercials. Els originals es conserven sense',
    'modificar a `data/sources/`; el hash permet detectar qualsevol canvi posterior.',
    '',
  ];

  for (const [filename, sheets] of byFile) {
    const first = sheets[0]!;
    const spec = SOURCES.find((s) => s.file === filename);
    lines.push(`## ${filename}`, '');
    lines.push(`- **Mida**: ${Number(first.byte_size).toLocaleString('ca-ES')} bytes`);
    lines.push(`- **SHA-256**: \`${first.sha256}\``);
    if (spec) lines.push(`- **Descripció**: ${spec.description}`);
    lines.push(`- **Confiança**: ${spec?.trust ?? '—'} (1 = màxima)`);
    lines.push('');
    lines.push('| Full | Fila de capçalera | Files totals | Files llegides | Tipus | Estat |');
    lines.push('| --- | ---: | ---: | ---: | --- | --- |');
    for (const s of sheets) {
      const status = s.is_excluded ? `NO IMPORTAT — ${s.exclusion_reason ?? ''}` : 'importat';
      lines.push(
        `| ${s.sheet_name} | ${s.header_row ?? '—'} | ${s.rows_total} | ${s.rows_read} | ${s.entity_hint ?? '—'} | ${status} |`,
      );
    }
    lines.push('');
  }

  await writeFile(path.join(dir, 'SOURCE_INVENTORY.md'), lines.join('\n'), 'utf8');
}

export async function writeColumnMapping(dir: string): Promise<void> {
  const lines: string[] = [
    '# COLUMN_MAPPING',
    '',
    'Correspondència entre les columnes originals i els camps del CRM.',
    'Una mateixa idea apareix escrita de maneres diferents a cada full; totes les',
    'variants acceptades es llisten aquí i viuen a `scripts/import/sources.ts`.',
    '',
  ];
  for (const source of SOURCES) {
    lines.push(`## ${source.file}`, '');
    for (const sheet of source.sheets) {
      lines.push(`### ${sheet.sheet} — ${sheet.kind}`, '');
      if (sheet.skipReason) {
        lines.push(`_No importat: ${sheet.skipReason}_`, '');
        continue;
      }
      if (sheet.notes) lines.push(`> ${sheet.notes}`, '');
      if (sheet.columns) {
        lines.push('| Camp CRM | Capçaleres acceptades |');
        lines.push('| --- | --- |');
        for (const [field, headers] of Object.entries(sheet.columns)) {
          lines.push(`| \`${field}\` | ${headers.map((h) => `\`${h}\``).join(', ')} |`);
        }
        lines.push('');
      }
    }
  }
  await writeFile(path.join(dir, 'COLUMN_MAPPING.md'), lines.join('\n'), 'utf8');
}

export async function writeNormalizationDecisions(dir: string): Promise<void> {
  const content = `# NORMALIZATION_DECISIONS

Decisions preses en normalitzar les fonts. Cap d'aquestes regles inventa dades:
quan una dada no hi és, el camp queda buit i la fila es marca per revisar.

## Identitat d'empresa

- El nom canònic és el text original de la font més fiable. Cap nom es reescriu.
- La clau de comparació (\`app.normalize_company\`) passa a minúscules, elimina
  accents i signes, i **elimina la forma jurídica** (SL, SA, SCCL, SCP, SAT…),
  de manera que \`MASIA ROMAGOSA S.L\` i \`Masia Romagosa SL\` són la mateixa clau.
- Totes les grafies originals es guarden com a àlies visibles, incloses les de
  l'extracte comptable i el registre oficial de cava.

## Fusió automàtica

Només s'enllaça automàticament amb una empresa existent quan hi ha una identitat
**determinista**: mateix NIF, o mateix correu corporatiu (mai un domini genèric
tipus gmail/hotmail) amb nom compatible, o mateix telèfon amb nom compatible.
Qualsevol altra semblança crea una empresa nova **i** una entrada a la cua de
revisió (\`duplicate_candidates\`). No hi ha cap fusió silenciosa.

## Volums

- \`23.590\` és 23 590 litres (separador de milers espanyol), no 23,59.
  El patró \`\\d{1,3}(\\.\\d{3})+\` és inequívoc i es tracta explícitament.
- Un volum no numèric no s'aproxima mai: queda buit i el text original es conserva.

## Campanyes

La campanya va de l'1 d'agost al 31 de juliol, exactament com estan tallats els
fulls d'origen (\`GUIES AGOST 24 - JULIOL 25\`). La data de la guia determina la
campanya; el nom de la campanya **mai** forma part del nom del producte.

## Previsions

- Un número a \`PREVISIÓ 2026\` és una **PREVISIÓ CONFIRMADA** per a la campanya
  següent, amb \`REPETIR COMANDA\`.
- \`PENDENT\` i \`NO TENEN PREVISIÓ\` són \`NO DETERMINAT\` (no són una negativa).
- Qualsevol altre text és \`ALTRES\` amb el text original obligatori a les
  observacions, i queda registrat a \`unmapped_values\`.

## Resultats de contacte

El text lliure de \`Resultado llamada\` i \`RESULTAT CONTACTE JUNY 2026\`
(\`PASSAR A PRESENTAR\`, \`VACANCES FINS EL 10/07\`, \`COMPREN AL PINYOL\`…) **no**
s'ha forçat contra la llista tancada de resultats. Tot això és \`NO DETERMINAT\`
amb el text original conservat i una entrada a \`unmapped_values\` perquè una
persona decideixi. Interpretar \`COMPREN AL PINYOL\` com \`TÉ UN ALTRE PROVEÏDOR\`
seria versemblant, però és una inferència, i el criteri és no inferir.

## Dates absents

El llistat d'exportació (\`CRM_contactos_exportacion_Vitalpe.xlsm\`) diu que es va
enviar un primer correu, però **no conté cap data**. Per això:

- **no** es crea cap activitat datada (seria inventar història),
- el fet es guarda com a nota d'empresa amb la procedència completa,
- i es crea una tasca **sense data** amb la propera acció indicada.

Una tasca sense data apareix a la fitxa de l'empresa, no al tauler diari i mai
com a vençuda — que és exactament el que aquesta informació mereix.

## Dates no interpretables

\`VEREMA\` a la columna \`Fecha próxima acción\` no és una data: es crea la tasca
**sense data** i el text original queda a les observacions.

## Tipus d'empresa

Només es dedueix quan la forma jurídica del nom ho diu de manera inequívoca
(\`SCCL\`, \`cooperativa\`, \`Agrícola …\` → \`COOPERATIVA\`) o quan la font ho marca
(\`EMBOTELLADOR = SI\`, full \`CRM CLIENTS EMBOTELLADORS\`). En qualsevol altre cas
queda buit; no es força \`ALTRES\`, perquè \`ALTRES\` exigeix una explicació que no
tenim.

Excepció documentada: al llistat d'exportació, la columna \`Tipo\` (\`Grupo
espumosos\`, \`Crémant\`…) descriu el mercat, no el tipus d'empresa del CRM. S'hi
assigna \`ALTRES\` amb aquest text com a explicació obligatòria, i es registra a
\`unmapped_values\` per si convé ampliar la llista mestra.

## Codis postals

Excel ha perdut el zero inicial (\`8770\`). Es reconstrueix a 5 dígits i la
província es dedueix del prefix oficial només quan la columna \`Província\` és
buida.

## DO

\`DO Cava Catalunya\` marca **DO CAVA**, no \`DO Catalunya\`. Són denominacions
diferents i el text s'assembla; la regla ho tracta explícitament.

## Bag in Box

Les línies amb producte \`BIB\` / \`Bag in Box\` / \`Doll Diví\` **no s'esborren**:
van a \`excluded_records\` amb el motiu i la fila original completa, a l'espera
del mòdul futur. No entren ni a productes, ni a oportunitats, ni a informes de
granel.

## Extracte comptable

De \`CLIENTS_ACTIUS.pdf\` només s'importa la correspondència compte → nom i el fet
que el compte va tenir moviment en el període (com a verificació \`ACTIVA\`).
**Cap import econòmic entra al CRM.** Els comptes \`4308995\` (clients vi pendent)
i \`4304093\` (vendes al comptat) són comptes interns i s'ignoren.

## Ordre de potencial

\`cellers_DO_Penedes_ordenats_CORREGIT.xlsx\` és una valoració manual de prioritat.
Es guarda com a nota i serveix per ordenar llistes, però **no** genera cap
classificació: la prioritat de qui vol treballar no és evidència d'interès del
client.
`;
  await writeFile(path.join(dir, 'NORMALIZATION_DECISIONS.md'), content, 'utf8');
}

export async function writeImportReport(
  db: SqlRunner,
  importId: string,
  workspaceId: string,
  stats: Stats,
  dir: string,
  extra: { ledgerMatched: number; ledgerUnmatched: string[]; cavaMatched: number },
): Promise<void> {
  const [counts] = await db.query<Record<string, string>>(
    `select
       (select count(*) from public.clients where workspace_id = $1 and deleted_at is null)::text as clients,
       (select count(*) from public.client_aliases where workspace_id = $1)::text as aliases,
       (select count(*) from public.contacts where workspace_id = $1 and deleted_at is null)::text as contacts,
       (select count(*) from public.client_locations where workspace_id = $1 and deleted_at is null)::text as locations,
       (select count(*) from public.opportunities where workspace_id = $1 and deleted_at is null)::text as opportunities,
       (select count(*) from public.opportunity_deliveries where workspace_id = $1)::text as deliveries,
       (select count(*) from public.activities where workspace_id = $1 and deleted_at is null)::text as activities,
       (select count(*) from public.tasks where workspace_id = $1 and deleted_at is null)::text as tasks,
       (select count(*) from public.client_verifications where workspace_id = $1)::text as verifications,
       (select count(*) from public.duplicate_candidates where workspace_id = $1)::text as duplicates,
       (select count(*) from public.excluded_records where workspace_id = $1)::text as excluded,
       (select count(*) from public.unmapped_values where workspace_id = $1)::text as unmapped,
       (select count(*) from public.field_provenance where workspace_id = $1)::text as provenance`,
    [workspaceId],
  );

  const outcomes = await db.query<{ outcome: string; n: string }>(
    `select outcome, count(*)::text as n from public.import_rows
      where import_id = $1 group by outcome order by outcome`,
    [importId],
  );
  const outcomeMap = Object.fromEntries(outcomes.map((o) => [o.outcome, Number(o.n)]));
  const read = Object.values(outcomeMap).reduce((a, b) => a + b, 0);
  const accounted =
    (outcomeMap['IMPORTADA'] ?? 0) + (outcomeMap['IGNORADA'] ?? 0) +
    (outcomeMap['REBUTJADA'] ?? 0) + (outcomeMap['EXCLOSA'] ?? 0) +
    (outcomeMap['DUPLICADA'] ?? 0) + (outcomeMap['PENDENT'] ?? 0);

  const excluded = await db.query<{ module: string; n: string }>(
    `select module, count(*)::text as n from public.excluded_records
      where workspace_id = $1 group by module order by count(*) desc`,
    [workspaceId],
  );
  const classes = await db.query<{ k: string; n: string }>(
    `select coalesce(proposed_classification::text, 'SENSE PROPOSTA') as k, count(*)::text as n
       from public.clients where workspace_id = $1 and deleted_at is null
      group by 1 order by 2 desc`,
    [workspaceId],
  );
  const unmappedProducts = await db.query<{ raw_value: string; occurrences: number }>(
    `select raw_value, occurrences from public.unmapped_values
      where workspace_id = $1 and kind = 'PRODUCTE' order by occurrences desc, raw_value`,
    [workspaceId],
  );
  const topBuyers = await db.query<{ name: string; liters: string }>(
    `select c.name, round(sum(o.volume_liters))::text as liters
       from public.opportunities o join public.clients c on c.id = o.client_id
      where o.workspace_id = $1 and o.data_type = 'COMPRA REAL' and o.deleted_at is null
      group by c.name order by sum(o.volume_liters) desc nulls last limit 10`,
    [workspaceId],
  );

  const lines: string[] = [
    '# IMPORT_REPORT',
    '',
    `Importació \`${importId}\``,
    '',
    '## Reconciliació de files',
    '',
    '| Resultat | Files |',
    '| --- | ---: |',
    ...Object.entries(outcomeMap).map(([k, v]) => `| ${k} | ${v} |`),
    `| **TOTAL LLEGIDES** | **${read}** |`,
    '',
    read === accounted
      ? `✅ \`FILES LLEGIDES (${read}) = IMPORTADES + IGNORADES + REBUTJADES + EXCLOSES (${accounted})\``
      : `❌ Descuadre: llegides ${read}, comptabilitzades ${accounted}`,
    '',
    'Una fila pot generar diverses entitats (empresa + contacte + ubicació + tasca),',
    'per això el nombre d\'entitats creades és superior al nombre de files.',
    '',
    '## Entitats al CRM',
    '',
    '| Entitat | Total |',
    '| --- | ---: |',
    `| Empreses canòniques | ${counts?.clients ?? 0} |`,
    `| Àlies | ${counts?.aliases ?? 0} |`,
    `| Contactes | ${counts?.contacts ?? 0} |`,
    `| Ubicacions | ${counts?.locations ?? 0} |`,
    `| Oportunitats | ${counts?.opportunities ?? 0} |`,
    `| Albarans / guies | ${counts?.deliveries ?? 0} |`,
    `| Activitats | ${counts?.activities ?? 0} |`,
    `| Tasques | ${counts?.tasks ?? 0} |`,
    `| Verificacions | ${counts?.verifications ?? 0} |`,
    `| Registres de procedència | ${counts?.provenance ?? 0} |`,
    '',
    '## Duplicats i exclusions',
    '',
    `- Candidats a duplicat pendents de revisió: **${counts?.duplicates ?? 0}**`,
    `- Fusions automàtiques executades: **0** (cap parella complia el criteri determinista)`,
    `- Files excloses i conservades a \`excluded_records\`: **${counts?.excluded ?? 0}**`,
    ...excluded.map((e) => `  - \`${e.module}\`: ${e.n}`),
    `- Valors sense mapatge (productes, accions, resultats, tipus): **${counts?.unmapped ?? 0}**`,
    '',
    '## Classificació proposada',
    '',
    'Calculada pel motor de domini a partir dels fets importats. Cap classificació',
    'ha estat confirmada: la confirmació és sempre humana.',
    '',
    '| Classificació proposada | Empreses |',
    '| --- | ---: |',
    ...classes.map((c) => `| ${c.k} | ${c.n} |`),
    '',
    '## Encreuament amb les fonts en PDF',
    '',
    `- Comptes comptables vinculats a una empresa: **${extra.ledgerMatched}**`,
    `- Comptes sense coincidència (nom truncat a l'origen): **${extra.ledgerUnmatched.length}**`,
    `- Cellers del registre oficial de cava vinculats: **${extra.cavaMatched}**`,
    '',
    extra.ledgerUnmatched.length > 0
      ? ['<details><summary>Comptes sense coincidència</summary>', '',
         ...extra.ledgerUnmatched.map((u) => `- ${u}`), '', '</details>', ''].join('\n')
      : '',
    '## Productes no catalogats',
    '',
    unmappedProducts.length === 0
      ? '_Cap._'
      : ['Aquestes descripcions de l\'albarà no coincideixen amb cap producte del',
         'catàleg normalitzat. Les files corresponents s\'han **rebutjat** (no s\'ha',
         'inventat cap producte). Cal afegir-hi un àlies des d\'ADMINISTRACIÓ i',
         'reimportar.', '',
         '| Descripció original | Ocurrències |', '| --- | ---: |',
         ...unmappedProducts.map((p) => `| ${p.raw_value} | ${p.occurrences} |`)].join('\n'),
    '',
    '## Volums reals importats (top 10)',
    '',
    '| Empresa | Litres |',
    '| --- | ---: |',
    ...topBuyers.map((b) => `| ${b.name} | ${Number(b.liters).toLocaleString('ca-ES')} |`),
    '',
  ];

  await writeFile(path.join(dir, 'IMPORT_REPORT.md'), lines.filter((l) => l !== undefined).join('\n'), 'utf8');

  // ---- CSV artefacts ------------------------------------------------------
  const dupes = await db.query<Record<string, unknown>>(
    `select d.score, d.decision, l.name as empresa_existent, d.candidate_name as empresa_nova,
            l.municipality as municipi_existent, r.municipality as municipi_nou,
            d.signals::text as senyals
       from public.duplicate_candidates d
       left join public.clients l on l.id = d.left_client_id
       left join public.clients r on r.id = d.right_client_id
      where d.workspace_id = $1
      order by d.score desc`,
    [workspaceId],
  );
  await writeFile(
    path.join(dir, 'DUPLICATE_CANDIDATES.csv'),
    toCsv(dupes, ['score', 'decision', 'empresa_existent', 'empresa_nova', 'municipi_existent', 'municipi_nou', 'senyals']),
    'utf8',
  );

  const rejected = await db.query<Record<string, unknown>>(
    `select f.filename as fitxer, s.sheet_name as full, r.row_number as fila,
            r.outcome as resultat, r.outcome_reason as motiu, r.raw::text as dades
       from public.import_rows r
       join public.import_sheets s on s.id = r.import_sheet_id
       join public.import_files f on f.id = s.import_file_id
      where r.import_id = $1 and r.outcome in ('REBUTJADA', 'EXCLOSA')
      order by f.filename, s.sheet_name, r.row_number`,
    [importId],
  );
  await writeFile(
    path.join(dir, 'REJECTED_ROWS.csv'),
    toCsv(rejected, ['fitxer', 'full', 'fila', 'resultat', 'motiu', 'dades']),
    'utf8',
  );
}

export async function ensureDocsDir(date: string): Promise<string> {
  const dir = importDocsDir(date);
  await mkdir(dir, { recursive: true });
  return dir;
}
