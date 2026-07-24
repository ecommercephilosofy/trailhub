/**
 * `pnpm env:check` — says which credentials are configured, and whether the
 * database they point at is reachable. Prints NO secret values, only lengths,
 * so the output is safe to paste anywhere.
 */
import { describeEnv, loadEnv } from './load-env';

const { loaded, missing } = loadEnv();

console.log('\n── Fitxers de configuració ──');
if (loaded.length === 0) {
  console.log(`  ✗ Cap trobat. Falten: ${missing.join(', ')}`);
  console.log('    Crea .env.local a l\'arrel del projecte i posa-hi les claus.');
} else {
  console.log(`  ✓ Carregats: ${loaded.join(', ')}`);
}

console.log('\n── Credencials ──');
for (const line of describeEnv()) console.log(line);

const url = process.env.DATABASE_URL;
console.log('\n── Base de dades ──');

if (!url) {
  console.log('  DATABASE_URL no definida → s\'utilitzarà la base local (.data/crm).');
  console.log('  Això és correcte per treballar al teu Mac.\n');
  process.exit(0);
}

// Never print the URL: it carries the password.
const host = (() => {
  try {
    return new URL(url).host;
  } catch {
    return '(no s\'ha pogut llegir el format de DATABASE_URL)';
  }
})();
console.log(`  Destí: ${host}`);

try {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15 });
  const [row] = await sql`
    select
      (select count(*) from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE')::int as taules,
      (select count(*) from pg_policies where schemaname = 'public')::int as politiques
  `;
  console.log(`  ✓ Connexió correcta`);
  console.log(`  Taules: ${row?.taules ?? 0}   Polítiques RLS: ${row?.politiques ?? 0}`);
  if ((row?.taules ?? 0) === 0) {
    console.log('  → Encara no hi ha esquema. Falta aplicar les migracions.');
  }
  await sql.end({ timeout: 5 });
  console.log('');
} catch (error) {
  // The driver puts the connection string in some errors; never echo it.
  const message = (error as Error).message.replace(url, '[DATABASE_URL]');
  console.log(`  ✗ No s'ha pogut connectar: ${message}\n`);
  process.exit(1);
}
