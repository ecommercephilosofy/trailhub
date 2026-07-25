/**
 * Loads discovered companies into the prospect review queue.
 *
 *   pnpm prospeccio -- data/prospects/do-penedes-2026-07.json
 *   pnpm prospeccio -- <fitxer> --apply
 *   pnpm prospeccio -- <fitxer> --remote --apply
 *
 * The input is a JSON file with a `source`, a `sourceUrl` and a list of
 * candidates. That shape is not decoration: a company nobody can trace back to
 * a public register is indistinguishable from an invented one, and this system
 * does not invent customers.
 *
 * What this script does NOT do:
 *
 *   · It does not create clients. Every row lands as `CANDIDAT` and waits for a
 *     person to press a button in PROSPECCIÓ.
 *   · It does not re-suggest a company that is already in the CRM — under any
 *     spelling it can match — nor one that was discarded before. Putting a
 *     rejected lead back in front of somebody every month is how a review queue
 *     stops being read.
 *   · It does not guess contact details. Name and municipality come from the
 *     source; a phone number nobody published is not filled in.
 */
import { loadEnv } from '../load-env';

loadEnv();

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, one } from './db';
import { normalizeCompany } from '@vitalpe/domain';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const file = argv.find((a) => !a.startsWith('--'));
const apply = argv.includes('--apply');
const remote = argv.includes('--remote');

if (!file) {
  console.error('\nÚs: pnpm prospeccio -- <fitxer.json> [--remote] [--apply]\n');
  process.exit(1);
}

interface Candidate {
  name: string;
  municipality?: string | null;
  province?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  suggestedProduct?: string | null;
  rationale?: string | null;
}

interface SourceDocument {
  source: string;
  sourceUrl?: string;
  consultedOn?: string;
  note?: string;
  candidates: Candidate[];
}

function assertTarget(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  if (/localhost|127\.0\.0\.1|\[::1\]/i.test(url)) return false;
  if (!remote) {
    console.error('\n✗ DATABASE_URL és remota i no has escrit --remote.\n');
    process.exit(1);
  }
  return true;
}

/** Both halves of "RAÓ SOCIAL - MARCA" name the same company. */
function identities(name: string): string[] {
  const out = [name];
  for (const sep of [' - ', ' / ', ' – ']) {
    if (name.includes(sep)) {
      for (const part of name.split(sep)) if (part.trim().length > 3) out.push(part.trim());
    }
  }
  return out;
}

function key(name: string): string | null {
  const normalised = normalizeCompany(name);
  return normalised === null || normalised.length === 0 ? null : normalised;
}

async function main(): Promise<void> {
  const isRemote = assertTarget();
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const db = await openDatabase(
    isRemote ? {} : { local: true, dataDir: path.join(root, '.data', 'crm') },
  );
  console.log(`Base de dades: ${db.kind}${isRemote ? ' REMOTA' : ' local'}${apply ? '' : ' (simulació)'}`);

  const doc = JSON.parse(await readFile(path.resolve(file!), 'utf8')) as SourceDocument;
  if (!doc.source || !Array.isArray(doc.candidates)) {
    throw new Error("El fitxer ha de tenir 'source' i 'candidates'.");
  }
  console.log(`Font: ${doc.source}${doc.sourceUrl ? ` — ${doc.sourceUrl}` : ''}`);

  const ws = await one<{ id: string }>(db, `select id from public.workspaces where slug = 'vitalpe'`);
  if (!ws) throw new Error('No hi ha espai de treball VITALPE.');

  // Everything the CRM already knows about, under every spelling.
  const clients = await db.query<{ norm: string }>(
    `select name_norm as norm from public.clients where workspace_id = $1 and deleted_at is null`,
    [ws.id],
  );
  const aliases = await db.query<{ norm: string }>(
    `select alias_norm as norm from public.client_aliases where workspace_id = $1`,
    [ws.id],
  );
  const known = new Set<string>();
  for (const row of [...clients, ...aliases]) if (row.norm) known.add(row.norm);

  const decided = await db.query<{ norm: string; status: string }>(
    `select name_norm as norm, status::text as status from public.prospects where workspace_id = $1`,
    [ws.id],
  );
  const seenProspects = new Map(decided.map((d) => [d.norm, d.status]));

  let inserted = 0;
  let alreadyClient = 0;
  let alreadyProspect = 0;
  const newOnes: string[] = [];

  for (const candidate of doc.candidates) {
    const name = candidate.name?.trim();
    if (!name) continue;

    const matchesClient = identities(name).some((variant) => {
      const k = key(variant);
      return k !== null && known.has(k);
    });
    if (matchesClient) { alreadyClient += 1; continue; }

    const k = key(name);
    if (k !== null && seenProspects.has(k)) { alreadyProspect += 1; continue; }

    newOnes.push(`${name}${candidate.municipality ? ` · ${candidate.municipality}` : ''}`);
    inserted += 1;
    if (!apply) continue;

    await db.query(
      `insert into public.prospects
         (workspace_id, name, municipality, province, website, phone, email,
          source, source_url, source_note, discovered_on, suggested_product, rationale)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               coalesce($11::date, (now() at time zone 'Europe/Madrid')::date),$12,$13)
       on conflict (workspace_id, name_norm) do nothing`,
      [
        ws.id, name, candidate.municipality ?? null, candidate.province ?? null,
        candidate.website ?? null, candidate.phone ?? null, candidate.email ?? null,
        doc.source, doc.sourceUrl ?? null, doc.note ?? null, doc.consultedOn ?? null,
        candidate.suggestedProduct ?? null, candidate.rationale ?? null,
      ],
    );
  }

  console.log('\n══ Prospecció ══');
  console.log(`  Candidats a la font      : ${doc.candidates.length}`);
  console.log(`  Ja són clients del CRM   : ${alreadyClient}`);
  console.log(`  Ja estaven a la cua      : ${alreadyProspect}`);
  console.log(`  Nous per revisar         : ${inserted}`);
  if (newOnes.length > 0) {
    console.log('\n  Primers 25:');
    for (const n of newOnes.slice(0, 25)) console.log(`    · ${n}`);
  }
  console.log(
    apply
      ? '\n✓ Desats com a CANDIDAT. Ningú és client fins que algú ho confirmi a PROSPECCIÓ.\n'
      : '\n  Simulació. Cap canvi escrit. Afegeix --apply.\n',
  );

  await db.close?.();
}

main().catch((error) => {
  console.error('\n✗', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
