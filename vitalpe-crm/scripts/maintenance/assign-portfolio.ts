/**
 * `pnpm clients:assign -- correu@empresa.com [--apply]`
 *
 * Gives every unowned company to one commercial.
 *
 * Vitalpe has a single commercial, so the imported portfolio has no owner: the
 * source spreadsheets never named one, and the importer refuses to invent data
 * (CLAUDE.md, rule 3). Ownership is what `app.can_edit_client` reads for the
 * COMERCIAL tier, so an unowned company is a company its own commercial cannot
 * edit. This closes that gap once, explicitly, with a person's e-mail as the
 * argument rather than a guess.
 *
 * Dry run by default. Nothing is written until `--apply` is passed, and the
 * transaction rolls back if the count differs from what the dry run reported.
 *
 * Companies that already have an owner are never reassigned: taking a company
 * off somebody silently is exactly the kind of invisible move the audit log
 * exists to prevent. Reassignment is a deliberate act, done from the client
 * page, where it is attributed.
 */
import { loadEnv } from '../load-env';

loadEnv();

const args = process.argv.slice(2).filter((a) => a !== '--');
const email = args.find((a) => !a.startsWith('--'));
const apply = args.includes('--apply');

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('\nÚs: pnpm clients:assign -- correu@empresa.com [--apply]\n');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('\n✗ Falta DATABASE_URL a .env.local\n');
  process.exit(1);
}

const { default: postgres } = await import('postgres');
const sql = postgres(databaseUrl, { max: 1, prepare: false });

interface Profile {
  id: string;
  workspace_id: string;
  role: string;
  full_name: string;
}

try {
  const [profile] = await sql<Profile[]>`
    select p.id,
           m.workspace_id,
           m.role::text as role,
           coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email) as full_name
      from public.profiles p
      join public.workspace_memberships m on m.user_id = p.id and m.status = 'ACTIU'
     where lower(p.email) = lower(${email})
     limit 1`;

  if (!profile) {
    console.error(`\n✗ No hi ha cap membre actiu amb el correu ${email}.\n`);
    process.exit(1);
  }

  // A GERENT is a reader (migration 20260724150000). Handing her the portfolio
  // would record an owner who cannot act on it.
  if (profile.role === 'GERENT') {
    console.error(
      `\n✗ ${profile.full_name} té el rol GERENT, que és de només lectura.` +
        `\n  La cartera ha de ser d’un COMERCIAL o d’un ADMIN que treballi els clients.\n`,
    );
    process.exit(1);
  }

  const [counts] = await sql<{ total: string; unowned: string; mine: string; others: string }[]>`
    select count(*)::text as total,
           count(*) filter (where owner_id is null)::text as unowned,
           count(*) filter (where owner_id = ${profile.id})::text as mine,
           count(*) filter (where owner_id is not null and owner_id <> ${profile.id})::text as others
      from public.clients
     where workspace_id = ${profile.workspace_id} and deleted_at is null`;

  console.log(`\n── Cartera de ${profile.full_name} (${profile.role}) ──`);
  console.log(`  Empreses actives      : ${counts?.total ?? '0'}`);
  console.log(`  Ja seves              : ${counts?.mine ?? '0'}`);
  console.log(`  D’una altra persona   : ${counts?.others ?? '0'}  (no es toquen)`);
  console.log(`  Sense propietari      : ${counts?.unowned ?? '0'}  ← s’assignaran`);

  const pending = Number(counts?.unowned ?? '0');

  if (pending === 0) {
    console.log('\n✓ No hi ha res per assignar.\n');
    await sql.end();
    process.exit(0);
  }

  if (!apply) {
    console.log('\n  Simulació. Cap canvi escrit.');
    console.log(`  Per aplicar-ho: pnpm clients:assign -- ${email} --apply\n`);
    await sql.end();
    process.exit(0);
  }

  // The audit trigger stamps every row, so the change is attributable; it needs
  // to know who did it. This runs outside a session, so the actor is the person
  // receiving the portfolio — which is the truth: it is their own catalogue.
  const updated = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claim.sub', ${profile.id}, true)`;
    const rows = await tx<{ id: string }[]>`
      update public.clients
         set owner_id = ${profile.id}, updated_at = now()
       where workspace_id = ${profile.workspace_id}
         and deleted_at is null
         and owner_id is null
      returning id`;

    if (rows.length !== pending) {
      // Somebody wrote between the count and the update. Better to fail and be
      // run again than to report a number that was never true.
      throw new Error(
        `esperava ${pending} files i n’he tocat ${rows.length}; la transacció es desfà`,
      );
    }
    return rows.length;
  });

  console.log(`\n✓ ${updated} empreses assignades a ${profile.full_name}.`);
  console.log('  Queda registrat a AUDITORIA amb el camp owner_id i qui l’ha canviat.\n');
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
