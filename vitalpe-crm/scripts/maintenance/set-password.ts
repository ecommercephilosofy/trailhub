/**
 * `pnpm user:password -- correu@empresa.com [--generate | --password=...]`
 *
 * Sets (or resets) a user's password in Supabase Auth.
 *
 * The app signs in with e-mail and password, so an account with no password
 * cannot get in. This is how one is given. `--generate` mints a strong random
 * password and prints it ONCE — the operator hands it to the person, who
 * changes it. `--password=…` sets a chosen one instead.
 *
 * The password is set with `email_confirm: true` so the account can sign in
 * immediately: without it, a project that requires e-mail confirmation would
 * block the very login this exists to enable, and confirmation needs the mailer
 * that this whole approach avoids.
 *
 * The value is never written to a file or a log. On `--generate` it is shown on
 * screen exactly once; there is no way to retrieve it afterwards, only to set a
 * new one.
 */
import { randomBytes } from 'node:crypto';
import { loadEnv } from '../load-env';

loadEnv();

const argv = process.argv.slice(2).filter((a) => a !== '--');
const email = argv.find((a) => !a.startsWith('--'))?.trim().toLowerCase();
const chosen = argv.find((a) => a.startsWith('--password='))?.slice('--password='.length);
const generate = argv.includes('--generate');

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || (!generate && !chosen)) {
  console.error(
    '\nÚs: pnpm user:password -- correu@empresa.com [--generate | --password=LaTeva]\n',
  );
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('\n✗ Falten NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY a .env.local\n');
  process.exit(1);
}

/**
 * A readable-but-strong password: 24 chars from an alphabet with no look-alikes
 * (no 0/O, 1/l/I), drawn from the CSPRNG with rejection sampling so every
 * character is uniform — no modulo bias.
 */
function strongPassword(length = 24): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_';
  const max = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= max) continue; // reject the biased tail
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

const password = chosen ?? strongPassword();

const { createClient } = await import('@supabase/supabase-js');
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

try {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(error.message);
  const user = data.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    console.error(`\n✗ No hi ha cap compte amb el correu ${email}. Crea'l amb pnpm user:add.\n`);
    process.exit(1);
  }

  const updated = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (updated.error) throw new Error(updated.error.message);

  console.log(`\n✓ Contrasenya establerta per a ${email}.`);
  if (generate) {
    console.log('\n  ┌─────────────────────────────────────────────');
    console.log(`  │  Contrasenya:  ${password}`);
    console.log('  └─────────────────────────────────────────────');
    console.log('\n  Es mostra UNA sola vegada. Passa-la a la persona per un canal segur');
    console.log('  i que la canviï en entrar. No queda desada enlloc.\n');
  } else {
    console.log('  La persona ja pot entrar amb el correu i aquesta contrasenya.\n');
  }
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
