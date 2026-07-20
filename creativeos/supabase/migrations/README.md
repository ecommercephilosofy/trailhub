# Migraciones de base de datos

`schema.sql` = instalaciones NUEVAS. Esta carpeta = cambios POSTERIORES para
instancias que ya existen.

Convención: `NNN_descripcion.sql` (001, 002…), SQL idempotente cuando sea posible
(`if not exists`, `add column if not exists`). El `update.sh` del cerebro las
aplica en orden y registra cada una en la tabla `schema_migrations` — nunca se
re-aplican.

Regla para desarrolladores: TODO cambio de schema va en un fichero aquí ADEMÁS
de actualizar schema.sql (para instalaciones nuevas).
