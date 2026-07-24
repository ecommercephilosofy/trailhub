# PERMISSIONS

Los roles son **presets de permisos**, no comprobaciones visuales. Toda esta
matriz está implementada en `supabase/migrations/20260723095000_rls.sql`, con
las restricciones del supervisor en `20260724150000_supervisor_read_only.sql`, y
probada en `supabase/tests/rls.test.ts` (32 pruebas). Ocultar un botón no es un
permiso: si una fila no debe verse, la política la filtra.

---

## Para qué existe cada rol

Vitalpe tiene **un solo comercial**. El CRM es su herramienta de trabajo, no un
sistema de gestión de equipo. De ahí que los roles no sean tres niveles de
jerarquía sino tres cosas distintas:

| Rol | Qué es |
| --- | --- |
| **ADMIN** | El comercial que trabaja la cartera y administra el sistema. Hoy: Carlos. |
| **GERENT** | Su superior. **Solo mira.** Ve la actividad diaria, las visitas y sus observaciones, lo que se ha cerrado. No escribe nada, en ninguna tabla. |
| **COMERCIAL** | Preset previsto para cuando haya más de un comercial. Trabaja su cartera y ve la del resto. |

El supervisor entra por `/supervisio`, que es su página de inicio. No es que la
interfaz le esconda los formularios: **la base de datos rechaza sus escrituras**.
Si mañana alguien le pusiera un botón de guardar delante, el `INSERT` afectaría a
cero filas.

---

## Matriz de capacidades

| Capacidad | ADMIN | GERENT ⁵ | COMERCIAL |
| --- | :---: | :---: | :---: |
| **Empresas** | | | |
| Ver todas las del espacio | ✅ | ✅ | ✅ |
| Crear empresa | ✅ | ❌ | ✅ |
| Editar cualquier empresa | ✅ | ❌ | ❌ |
| Editar empresa asignada | ✅ | ❌ | ✅ |
| Borrado físico | ✅ | ❌ | ❌ |
| Fusionar empresas | ✅ ¹ | ❌ | ❌ |
| **Contactos y ubicaciones** | | | |
| Ver | ✅ | ✅ | ✅ |
| Editar (empresa asignada) | ✅ | ❌ | ✅ |
| Editar (cualquier empresa) | ✅ | ❌ | ❌ |
| **Asignaciones** | | | |
| Ver | ✅ | ✅ | ✅ |
| Reasignar cliente | ✅ | ❌ | ❌ |
| **Historial comercial** | | | |
| Ver | ✅ | ✅ | ✅ |
| Crear acción | ✅ | ❌ | ✅ |
| Modificar acción existente | ✅ | ❌ | ❌ |
| Eliminar acción | ❌ ² | ❌ ² | ❌ ² |
| **Oportunidades** | | | |
| Ver | ✅ | ✅ | ✅ |
| Editar (empresa asignada) | ✅ | ❌ | ✅ |
| Registrar albarán / compra | ✅ | ❌ | ❌ |
| **Tareas** | | | |
| Ver todas | ✅ | ✅ | ✅ |
| Crear | ✅ | ❌ | ✅ |
| Editar propias / asignadas | ✅ | ❌ | ✅ |
| Editar las de otro comercial | ✅ | ❌ | ❌ |
| **Visitas** | | | |
| Ver todas | ✅ | ✅ | ✅ |
| Crear | ✅ | ❌ | ✅ |
| Editar propias | ✅ | ❌ | ✅ |
| Editar las de otro | ✅ | ❌ | ❌ |
| **Google Calendar** | | | |
| Conectar su cuenta | ✅ | ✅ | ✅ |
| Ver la conexión de otro | ❌ | ❌ | ❌ |
| Leer tokens OAuth | ❌ ³ | ❌ ³ | ❌ ³ |
| **Notas de voz** | | | |
| Crear y gestionar las propias | ✅ | ❌ | ✅ |
| Leer las de otro | ✅ | ✅ | ❌ |
| **Móvil y geolocalización** | | | |
| Dispositivos, geovallas, eventos | propios | propios | propios |
| Ver los de otro usuario | ❌ | ❌ | ❌ |
| **Usuarios** | | | |
| Ver miembros | ✅ | ✅ | ✅ |
| Invitar / revocar | ✅ | ❌ | ❌ |
| Cambiar roles | ✅ | ❌ | ❌ |
| **Importaciones** | | | |
| Ver informes | ✅ | ✅ | ❌ |
| Ejecutar / deshacer | ✅ | ❌ | ❌ |
| Plantillas de mapeo | ✅ | ❌ | ❌ |
| **Duplicados** | | | |
| Ver la cola | ✅ | ✅ | ❌ |
| Decidir | ✅ | ❌ | ❌ |
| **Auditoría** | | | |
| Leer | ✅ | ✅ | ❌ |
| Modificar o borrar | ❌ ⁴ | ❌ ⁴ | ❌ ⁴ |
| **Catálogo** | | | |
| Leer productos y campañas | ✅ | ✅ | ✅ |
| Resolver valores sin mapear | ✅ | ❌ | ❌ |

¹ `app.merge_clients` tiene el `EXECUTE` revocado de `authenticated`: se ejecuta
desde el servidor con el rol de servicio, tras la decisión explícita de un ADMIN.
La fusión guarda un *snapshot* completo y es reversible.

² Las actividades **no tienen política de `DELETE`**. Nadie las borra por la API.
Una corrección se hace editando con auditoría (solo gerencia) o creando una
acción correctiva.

³ `access_token_enc`, `refresh_token_enc` y `sync_token` tienen el permiso
revocado a nivel de columna para `anon` y `authenticated`. Ni el propietario los
lee desde el cliente. Solo el servidor, con el rol de servicio.

⁴ `audit_log` solo tiene política de `SELECT`. Las filas entran exclusivamente
por el *trigger* `app.audit_trigger()`, que es `SECURITY DEFINER`.

⁵ Toda la columna GERENT es **lectura**. La migración
`20260724150000_supervisor_read_only.sql` movió cada política de escritura de
`app.is_manager()` a `app.is_admin()`. `app.is_manager()` sigue existiendo y
sigue gobernando el `SELECT` de las dos categorías: por eso el supervisor lo ve
todo. Seis pruebas del bloque `el supervisor només mira` comprueban que no puede
editar una empresa, crearla, reasignarla, enmendar el historial ni tocar tareas
o visitas — y que sí las ve.

---

## Qué ve el supervisor en `/supervisio`

Una sola página, sin un solo control que cambie datos:

- Seis cifras de cabecera del periodo (visitas hechas, actividades, empresas
  cerradas, litros comprometidos, tareas pendientes, empresas sin contacto).
- **Visitas hechas, con su objetivo y sus observaciones.** Es lo que pidió: no
  solo que hubo una visita, sino qué se dijo en ella.
- **Lo que se ha ganado**: clientes cerrados y previsiones confirmadas del
  periodo, con litros y producto.
- Próximas visitas, tareas vencidas y empresas en silencio (>60 días).
- El registro de actividad completo del periodo.

Las cifras se calculan en la consulta, no se guardan: no hay un contador que
pueda quedarse desfasado respecto a los hechos.

---

## La regla del gerente y el calendario personal

Un GERENT ve **el trabajo comercial** de su equipo: visitas del CRM, tareas,
actividades, resultados. **No ve la cuenta de Google de nadie.**

Esto no es una convención de interfaz, es la política
`gcal_connections_own`, que restringe `google_calendar_connections` a
`user_id = auth.uid()` sin excepción para gerencia. La prueba
`la connexió de Google d'un usuari no la veu ningú més, ni el gerent` lo
verifica.

Consecuencia de diseño: el CRM solo sincroniza eventos que él mismo creó o que
están en el calendario que el usuario ha elegido explícitamente para el CRM. Los
eventos personales nunca entran.

---

## Cómo se decide "puede editar esta empresa"

```sql
app.can_edit_client(client_id) :=
     app.is_admin(workspace)                      -- ADMIN, no GERENT
  OR (app.role_in(workspace) = 'COMERCIAL'
      AND (owner_id = auth.uid()
           OR existe una asignación activa para auth.uid()))
```

Es `SECURITY DEFINER` con `search_path` fijo. Si no lo fuera, una política sobre
`workspace_memberships` se llamaría a sí misma en bucle.

Todo lo que cuelga de una empresa —contactos, ubicaciones, oportunidades,
verificaciones— se rige por esta misma función, así que sacar a GERENT de aquí
lo sacó de todos esos sitios a la vez, sin tener que enumerarlos.

**La cartera tiene dueño.** Las 801 empresas importadas llegaron sin
`owner_id`: las hojas de origen no nombraban a nadie y el importador no inventa
datos. Se asignaron a Carlos con `pnpm clients:assign -- <correo> --apply`, que
simula primero, nunca reasigna lo que ya tiene dueño y queda en la auditoría.
Sin ese paso, un COMERCIAL no podría editar su propia cartera.

---

## Un comercial no puede subirse el rol

La política de escritura sobre `workspace_memberships` exige `app.is_admin()`
tanto en `USING` como en `WITH CHECK`. El `WITH CHECK` se evalúa contra la fila
**nueva**, así que no basta con ser admin para escribir: hay que serlo también
después. Un `UPDATE ... SET role = 'ADMIN'` lanzado por un comercial afecta a
cero filas.

Probado en `un COMERCIAL no es pot apujar el rol`.

---

## Aislamiento entre espacios de trabajo

Toda entidad comercial lleva `workspace_id` y toda política empieza por
`app.is_member(workspace_id)`. Un usuario de otro espacio no ve nada, aunque sea
ADMIN en el suyo. Probado en cuatro pruebas de `aïllament entre espais de treball`.

---

## Cómo añadir permisos granulares sin rehacer nada

El modelo ya lo permite:

1. `workspace_memberships.extra_permissions` es un `jsonb` reservado para ello.
2. Se añade una función `app.has_permission(ws uuid, perm text)` que lea primero
   `extra_permissions` y caiga en el preset del rol si no hay nada.
3. Las políticas pasan de `app.is_manager(workspace_id)` a
   `app.has_permission(workspace_id, 'clients.edit_any')`.

Los roles siguen funcionando como presets; el cambio es aditivo y no toca ni el
esquema de tablas ni la capa de aplicación.
