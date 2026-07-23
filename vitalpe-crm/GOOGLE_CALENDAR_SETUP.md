# GOOGLE_CALENDAR_SETUP

**Sin credenciales de Google la aplicación funciona igual.** Las visitas se
sincronizan con un proveedor local en memoria que implementa la misma interfaz,
con las mismas semánticas de `ETag` y *sync token*. La interfaz lo dice
explícitamente:

> **Google Calendar no està configurat.** Les visites se sincronitzen amb el
> calendari local i tot funciona igual.

Esta guía es para activar la sincronización real.

---

## 1. Google Cloud

1. **Crear proyecto** en <https://console.cloud.google.com> → *New Project*.
   Nombre sugerido: `vitalpe-crm`.
2. **Habilitar la API**: *APIs & Services → Library → Google Calendar API →
   Enable*.
3. **Pantalla de consentimiento**: *OAuth consent screen*.
   - Tipo **Internal** si Vitalpe usa Google Workspace (recomendado: sin
     verificación). **External** en caso contrario, y añadir a cada comercial
     como *Test user* mientras la app no esté verificada.
   - Rellenar nombre, correo de soporte y dominio.
4. **Credenciales**: *Credentials → Create credentials → OAuth client ID →
   Web application*.
   - **Authorized redirect URI** — exactamente el valor de
     `GOOGLE_REDIRECT_URI`:
     - desarrollo: `http://localhost:3004/api/google/callback`
     - producción: `https://<tu-dominio>/api/google/callback`
   - Guardar **Client ID** y **Client secret**.

---

## 2. Alcances

Se piden los mínimos, y cada uno está justificado en el código
(`packages/integrations/src/calendar/google.ts`):

| Alcance | Para qué |
| --- | --- |
| `calendar.events` | Crear, leer, modificar y cancelar los eventos de visita |
| `calendar.calendarlist.readonly` | Listar los calendarios para que el usuario elija cuál usar |
| `calendar.app.created` | **Solo** si el usuario pide crear el calendario dedicado |

El tercero no se solicita salvo que el usuario opte por crear
`VITALPE — VISITES COMERCIALS`.

Se pide `access_type=offline` y `prompt=consent` para obtener *refresh token*,
sin el cual la sincronización moriría en una hora.

---

## 3. Webhook

Google solo entrega notificaciones a una **URL pública con HTTPS y certificado
válido**. No acepta `localhost` ni certificados autofirmados.

```
GOOGLE_CALENDAR_WEBHOOK_URL=https://<tu-dominio>/api/google/webhook
```

En desarrollo, un túnel:

```bash
ngrok http 3004
# usar la URL https que devuelve
```

**Sin webhook la sincronización sigue funcionando**, solo que Google → CRM deja
de ser instantáneo y depende de la reconciliación periódica. Merece la pena
configurarlo, pero no es un requisito para empezar.

Los canales caducan a los **7 días** (máximo de Google). Hay renovación
programada y limpieza de canales antiguos.

---

## 4. Variables

```bash
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>          # SERVIDOR — secreto
GOOGLE_REDIRECT_URI=https://<dominio>/api/google/callback
GOOGLE_CALENDAR_WEBHOOK_URL=https://<dominio>/api/google/webhook

APP_ENCRYPTION_KEY=<openssl rand -base64 48>  # SERVIDOR — cifra los tokens
```

`APP_ENCRYPTION_KEY` es obligatoria: los tokens se guardan cifrados con
AES-256-GCM. Cambiarla invalida las conexiones existentes y obliga a reconectar.

Ninguna de estas variables lleva prefijo `NEXT_PUBLIC_`: ninguna debe llegar al
navegador.

---

## 5. Conectar y verificar

1. `CALENDARI → GOOGLE CALENDAR` (o `/calendari/google`).
2. **CONNECTAR AMB GOOGLE** → consentimiento → vuelta a la aplicación.
3. Elegir un calendario existente o crear `VITALPE — VISITES COMERCIALS`.
4. Comprobar que aparecen estado, última sincronización y errores.

**Prueba de ida y vuelta:**

| Paso | Resultado esperado |
| --- | --- |
| Crear una visita en el CRM | Aparece en Google en segundos |
| Cambiar la hora en Google | El CRM actualiza visita, tarea y "propera visita" de la ficha |
| Cambiar la hora en el CRM | Google se actualiza; **no** vuelve un eco al CRM |
| Borrar el evento en Google | Visita `CANCEL·LADA`, origen `GOOGLE CALENDAR`. **Nada se borra** |
| `FORÇAR RECONCILIACIÓ` | Recupera cambios perdidos si el webhook falló |

---

## 6. Cómo se evitan los bucles

Cuatro mecanismos, y una prueba que **afirma cero llamadas salientes** cuando un
cambio llega desde Google:

- **Hash del contenido sincronizado** — si el hash no cambió, no se envía nada.
- **`ETag`** — se manda como `If-Match`; un 412 significa que Google cambió
  primero.
- **Origen del último cambio** — corta el rebote en seco.
- **Idempotencia del webhook** por `(channel_id, message_number)`.

Conflictos simples: gana la última modificación válida, y queda auditado.
Conflictos simultáneos divergentes: se muestra la comparación y el usuario elige.

---

## 7. Identificación de eventos

Nunca por el título. Cada evento lleva *private extended properties*:

```json
{ "crmWorkspaceId": "…", "crmClientId": "…", "crmVisitId": "…", "crmTaskId": "…" }
```

Si alguien renombra el evento en Google, el vínculo aguanta.

---

## 8. Privacidad

- El CRM **solo** toca eventos que creó él o que están en el calendario elegido
  para el CRM.
- La conexión de Google es **estrictamente personal**: un GERENT ve las visitas
  comerciales de su equipo, nunca la cuenta ni el calendario de nadie
  (`PERMISSIONS.md`).
- Los tokens no son legibles desde el cliente ni por su propietario: permiso
  revocado a nivel de columna.
- El contenido del evento incluye empresa, dirección, contacto, teléfono,
  objetivo, producto y enlaces — y **nunca** transcripciones, historial completo
  ni secretos. Hay una prueba que lo verifica aunque se le pasen esos datos.

---

## 9. Errores frecuentes

| Síntoma | Causa |
| --- | --- |
| `redirect_uri_mismatch` | La URI de Google Cloud no coincide **exactamente** con `GOOGLE_REDIRECT_URI` |
| Deja de sincronizar tras una hora | Falta `access_type=offline`: no hay *refresh token*. Desconectar y reconectar |
| El webhook nunca llega | La URL no es HTTPS pública, o el canal caducó |
| `410 Gone` en el log | *Sync token* invalidado por Google; se dispara resincronización completa sola |
| `403` persistente | Falta habilitar la Calendar API en el proyecto |
| No se puede crear el calendario | No se concedió `calendar.app.created` |

El panel `ADMINISTRACIÓ → INTEGRACIONS` muestra el estado de los canales y los
últimos errores **sin exponer ningún secreto**.
