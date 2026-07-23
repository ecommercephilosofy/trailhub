# PERMISSIONS

Los roles son **presets de permisos**, no comprobaciones visuales. Toda esta
matriz está implementada en `supabase/migrations/20260723095000_rls.sql` y
probada en `supabase/tests/rls.test.ts` (21 pruebas). Ocultar un botón no es un
permiso: si una fila no debe verse, la política la filtra.

---

## Matriz de capacidades

| Capacidad | ADMIN | GERENT | COMERCIAL |
| --- | :---: | :---: | :---: |
| **Empresas** | | | |
| Ver todas las del espacio | ✅ | ✅ | ✅ |
| Crear empresa | ✅ | ✅ | ✅ |
| Editar cualquier empresa | ✅ | ✅ | ❌ |
| Editar empresa asignada | ✅ | ✅ | ✅ |
| Borrado físico | ✅ | ❌ | ❌ |
| Fusionar empresas | ✅ ¹ | ❌ | ❌ |
| **Contactos y ubicaciones** | | | |
| Ver | ✅ | ✅ | ✅ |
| Editar (empresa asignada) | ✅ | ✅ | ✅ |
| Editar (cualquier empresa) | ✅ | ✅ | ❌ |
| **Asignaciones** | | | |
| Ver | ✅ | ✅ | ✅ |
| Reasignar cliente | ✅ | ✅ | ❌ |
| **Historial comercial** | | | |
| Ver | ✅ | ✅ | ✅ |
| Crear acción | ✅ | ✅ | ✅ |
| Modificar acción existente | ✅ | ✅ | ❌ |
| Eliminar acción | ❌ ² | ❌ ² | ❌ ² |
| **Oportunidades** | | | |
| Ver | ✅ | ✅ | ✅ |
| Editar (empresa asignada) | ✅ | ✅ | ✅ |
| Registrar albarán / compra | ✅ | ✅ | ❌ |
| **Tareas** | | | |
| Ver todas | ✅ | ✅ | ✅ |
| Crear | ✅ | ✅ | ✅ |
| Editar propias / asignadas | ✅ | ✅ | ✅ |
| Editar las de otro comercial | ✅ | ✅ | ❌ |
| **Visitas** | | | |
| Ver todas | ✅ | ✅ | ✅ |
| Crear | ✅ | ✅ | ✅ |
| Editar propias | ✅ | ✅ | ✅ |
| Editar las de otro | ✅ | ✅ | ❌ |
| **Google Calendar** | | | |
| Conectar su cuenta | ✅ | ✅ | ✅ |
| Ver la conexión de otro | ❌ | ❌ | ❌ |
| Leer tokens OAuth | ❌ ³ | ❌ ³ | ❌ ³ |
| **Notas de voz** | | | |
| Crear y gestionar las propias | ✅ | ✅ | ✅ |
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
     app.is_manager(workspace)                    -- ADMIN o GERENT
  OR (app.role_in(workspace) = 'COMERCIAL'
      AND (owner_id = auth.uid()
           OR existe una asignación activa para auth.uid()))
```

Es `SECURITY DEFINER` con `search_path` fijo. Si no lo fuera, una política sobre
`workspace_memberships` se llamaría a sí misma en bucle.

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
