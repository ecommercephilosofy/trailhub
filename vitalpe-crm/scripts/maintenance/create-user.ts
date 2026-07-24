/**
 * `pnpm user:add -- correu@empresa.com ADMIN "Nom" "Cognoms"`
 *
 * Creates the first real user. After that, people should be invited from
 * ADMINISTRACIÓ → USUARIS; this exists to solve the bootstrap problem — an
 * empty workspace has nobody who can send an invitation.
 *
 * Creates the account in Supabase Auth (so the sign-in code can be e-mailed to
 * it) and the workspace membership that authorises it. Both are required:
 * authenticating is not the same as being allowed in.
 */
import { loadEnv } from '../load-env';

loadEnv();

// pnpm forwards its own `--` separator through to the script; drop it so
// `pnpm user:add -- correu@…` and `tsx …/create-user.ts correu@…` behave alike.
const [email, roleArg, firstName, lastName] = process.argv.slice(2).filter((a) => a !== '--');
const role = (roleArg ?? 'ADMIN').toUpperCase();

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('\nÚs: pnpm user:add -- correu@empresa.com [ADMIN|GERENT|COMERCIAL] [Nom] [Cognoms]\n');
  process.exit(1);
}
if (!['ADMIN', 'GERENT', 'COMERCIAL'].includes(role)) {
  console.error(`\n✗ Rol no vàlid: ${role}. Ha de ser ADMIN, GERENT o COMERCIAL.\n`);
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.DATABASE_URL;

if (!supabaseUrl || !serviceKey || !databaseUrl) {
  console.error('\n✗ Falten NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o DATABASE_URL a .env.local\n');
  process.exit(1);
}

const { createClient } = await import('@supabase/supabase-js');
const { default: postgres } = await import('postgres');

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  // 1 — the auth account. Confirmed on creation: the person proves control of
  // the address every time they sign in with a fresh code anyway.
  let userId: string;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { first_name: firstName ?? null, last_name: lastName ?? null },
  });

  if (created.error) {
    if (!/already been registered|already exists/i.test(created.error.message)) {
      throw new Error(created.error.message);
    }
    // Idempotent: re-running to fix a role must not fail.
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw new Error(error.message);
    const existing = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!existing) throw new Error(`El compte ${email} existeix però no s'ha pogut localitzar.`);
    userId = existing.id;
    console.log(`  · El compte ja existia a Supabase Auth`);
  } else {
    userId = created.data.user.id;
    console.log(`  ✓ Compte creat a Supabase Auth`);
  }

  // 2 — the profile. A trigger normally does this; do it defensively in case
  // the account predates the trigger.
  await sql`
    insert into public.profiles (id, email, first_name, last_name)
    values (${userId}, ${email}, ${firstName ?? null}, ${lastName ?? null})
    on conflict (id) do update
      set email = excluded.email,
          first_name = coalesce(excluded.first_name, public.profiles.first_name),
          last_name  = coalesce(excluded.last_name,  public.profiles.last_name)
  `;
  console.log('  ✓ Perfil desat');

  // 3 — the membership. Without it, signing in succeeds and access is refused.
  const [ws] = await sql<{ id: string; name: string }[]>`
    select id, name from public.workspaces order by created_at limit 1
  `;
  if (!ws) throw new Error('No hi ha cap espai de treball. Executa primer pnpm db:push.');

  await sql`
    insert into public.workspace_memberships (workspace_id, user_id, role, status, activated_at)
    values (${ws.id}, ${userId}, ${role}::app.user_role, 'ACTIU', now())
    on conflict (workspace_id, user_id) do update
      set role = excluded.role, status = 'ACTIU'
  `;
  console.log(`  ✓ Membre de «${ws.name}» amb rol ${role}`);

  console.log(`\n✓ ${email} ja pot entrar.`);
  console.log('  A la pantalla d\'accés, escriu el correu i rebràs un codi de sis xifres.\n');
} catch (error) {
  const message = (error as Error).message.split(databaseUrl).join('[DATABASE_URL]');
  console.error(`\n✗ ${message}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
