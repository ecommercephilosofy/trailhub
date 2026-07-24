# DEPLOYMENT

Orden recomendado: **Supabase → Vercel → Google Cloud → EAS**. Cada paso deja el
sistema funcionando; los siguientes solo añaden capacidades.

---

## 1. Supabase

1. Crear proyecto en <https://supabase.com> (región `eu-west` por cercanía).
   Guardar la contraseña de la base de datos.
2. Anotar de *Project Settings → API*:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` — **solo servidor**, nunca en el navegador ni en
     la app móvil.

3. **Aplicar las migraciones:**

```bash
supabase link --project-ref <ref>
supabase db push          # aplica supabase/migrations/ en orden
```

4. **Seed** (catálogo normalizado y espacio de trabajo VITALPE):

```bash
psql "$DATABASE_URL" -f supabase/seed.sql
```

Es re-ejecutable: todo lleva `ON CONFLICT DO NOTHING`.

5. **Verificar que la RLS está activa en las 41 tablas:**

```sql
select c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
-- debe devolver 0 filas
```

6. **Storage**: crear el bucket **privado** `notes-de-veu`. Sin acceso público.

7. **Importar los datos reales** (una vez, con la base ya migrada):

```bash
pnpm import:run -- --remote
```

Revisar `docs/imports/<fecha>/IMPORT_REPORT.md` y comprobar que la identidad de
reconciliación cuadra antes de dar por buena la carga.

8. **Crear los usuarios y darles contraseña.** El acceso es con correo y
   contraseña (`signInWithPassword`), no con código por email: la app no depende
   del correo de Supabase, que solo se puede personalizar tras configurar un SMTP
   propio y está limitado a unos pocos envíos por hora.

```bash
pnpm user:add      -- carlos.espiells@gmail.com ADMIN Carlos Espiells
pnpm user:password -- carlos.espiells@gmail.com --generate
```

`user:password --generate` imprime una contraseña fuerte **una sola vez**; se le
pasa a la persona por un canal seguro y la cambia al entrar, desde
**EL MEU COMPTE · CONTRASENYA**. Para fijar una contraseña concreta:
`--password=LaQueSea`. No hace falta tocar plantillas de email ni el SMTP.

---

## 2. Vercel

1. Importar el repositorio. **Root directory: `apps/web`.**
2. *Framework preset*: Next.js. Vercel detecta pnpm y el workspace.
3. Variables de entorno (*Production* y *Preview*):

| Variable | Ámbito | Obligatoria |
| --- | --- | :---: |
| `NEXT_PUBLIC_APP_URL` | cliente | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | cliente | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | cliente | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | **servidor** | ✅ |
| `DATABASE_URL` | **servidor** | ✅ |
| `APP_ENCRYPTION_KEY` | **servidor** | ✅ |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` / `_WEBHOOK_URL` | servidor | ⬜ |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | servidor | ⬜ |
| `TRANSCRIPTION_PROVIDER`, `OPENAI_API_KEY` | servidor | ⬜ |
| `GEOCODING_PROVIDER`, `GOOGLE_MAPS_API_KEY` | servidor | ⬜ |
| `SENTRY_DSN` | servidor | ⬜ |

Generar la clave de cifrado:

```bash
openssl rand -base64 48
```

> Solo lo marcado con ✅ hace falta para arrancar. Lo demás activa integraciones;
> sin ello, cada una cae a su proveedor local y la aplicación sigue completa.

4. `DATABASE_URL` debe usar el **pooler** de Supabase (puerto 6543) en
   producción, no la conexión directa.

5. Desplegar y comprobar:
   - `/entrar` responde,
   - se puede iniciar sesión,
   - `/inici` muestra trabajo real,
   - `ADMINISTRACIÓ → INTEGRACIONS` refleja el estado esperado.

### HTTPS

Vercel lo da por defecto. Es requisito para el webhook de Google y para los
Universal Links / App Links del móvil.

---

## 3. Google Cloud

Ver **`GOOGLE_CALENDAR_SETUP.md`**. Resumen:

1. Proyecto → habilitar Calendar API.
2. Pantalla de consentimiento (**Internal** si hay Workspace).
3. OAuth client ID web, con la *redirect URI* **exacta** de producción.
4. `GOOGLE_CALENDAR_WEBHOOK_URL` apuntando a `https://<dominio>/api/google/webhook`
   — HTTPS público obligatorio.

**Después de desplegar en Vercel**, no antes: la *redirect URI* necesita el
dominio final.

---

## 4. Expo / EAS

> ⚠️ **La app móvil está parcial**: configuración, deep links y lógica de núcleo
> probada; **las pantallas no están construidas**. Estos pasos son válidos para
> generar una Development Build y continuar el trabajo. Ver `PROGRESS.md`.

```bash
pnpm dlx eas-cli login
cd apps/mobile
eas build:configure
```

Variables (`eas.json` o EAS Secrets):

```bash
EXPO_PUBLIC_API_URL=https://<dominio>
EXPO_PROJECT_ID=<id>
```

**Development Build** — obligatoria para el geofencing en segundo plano; Expo Go
**no** sirve:

```bash
eas build --profile development --platform ios
eas build --profile development --platform android
```

**Producción:**

```bash
eas build --profile production --platform all
eas submit --platform ios       # App Store Connect
eas submit --platform android   # Google Play
```

### Deep links

Para que `https://<dominio>/clients/<id>` abra la app:

- **iOS**: servir `/.well-known/apple-app-site-association` (sin extensión,
  `Content-Type: application/json`) con el App ID.
- **Android**: servir `/.well-known/assetlinks.json` con el SHA-256 del
  certificado de firma.

Ambos desde el dominio de Vercel. Sin ellos el enlace abre la ficha web, que es
el respaldo correcto.

---

## 5. Entornos

| Entorno | Base de datos | Web | Móvil |
| --- | --- | --- | --- |
| Desarrollo | PGlite local (`.data/crm`) | `pnpm dev` :3004 | Development Build |
| Pruebas | Proyecto Supabase aparte | Preview de Vercel | Perfil `preview` |
| Producción | Supabase gestionado | Producción de Vercel | Perfil `production` |

Nunca compartir `SUPABASE_SERVICE_ROLE_KEY` ni `APP_ENCRYPTION_KEY` entre
entornos.

---

## 6. Tareas periódicas

Dos trabajos, con Supabase Scheduled Functions o Vercel Cron:

| Trabajo | Frecuencia | Qué hace |
| --- | --- | --- |
| Renovar canales de Google | diaria | Renueva los que caducan (máx. 7 días) y limpia los viejos |
| Reconciliación de calendario | cada 6 h | Recupera cambios cuyo webhook se perdió |

Ninguno es imprescindible el primer día; sin ellos la sincronización se degrada
a manual (`FORÇAR RECONCILIACIÓ`).

---

## 7. Antes de dar por buena una release

- [ ] `pnpm test` → 636 pruebas en verde
- [ ] `pnpm lint` y `pnpm typecheck` limpios
- [ ] `pnpm build` sin errores
- [ ] Migraciones aplicadas y RLS activa en las 41 tablas
- [ ] La importación reconcilia (leídas = importadas + ignoradas + rechazadas + excluidas)
- [ ] Un COMERCIAL no accede a administración
- [ ] Ningún secreto en variables `NEXT_PUBLIC_`
- [ ] Copia de seguridad tomada antes de importar en producción

---

## 8. Reversión

- **Web**: *Instant Rollback* en Vercel al despliegue anterior.
- **Base de datos**: las migraciones son *append-only*. Para deshacer, escribir
  una migración nueva que revierta; no editar la aplicada.
- **Importación**: `ADMINISTRACIÓ → IMPORTACIONS` permite deshacer cuando es
  seguro, apoyándose en `entities_created` de cada fila de staging.
- **Fusión de empresas**: reversible desde el *snapshot* de `client_merges`.
