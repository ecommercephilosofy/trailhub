// Lógica de atribución QB → editor. Es el camino del DINERO (bonuses):
// cualquier cambio aquí debe pasar los tests de src/lib/__tests__/attribution.test.js.

// Código de creativo del título de la tarjeta (FER0077_HOOK2 → FER0077-HOOK2).
// Al APROBAR, la tarjeta se casa con ese código → Performance y el análisis
// semanal saben qué producción originó cada ad.
export function extractAdCode(title) {
  const m = String(title || '').toUpperCase().replace(/_/g, '-')
    .match(/[A-Z]{2,5}\d{2,5}(?:-[A-Z0-9]{1,6})?/)
  return m ? m[0] : null
}

// tracking_code del brief → user_id del editor asignado (solo tarjetas con ambos).
export function qbToEditorMap(cards) {
  return Object.fromEntries((cards || [])
    .filter((c) => c.brief_tracking_code && c.assigned_editor)
    .map((c) => [c.brief_tracking_code, c.assigned_editor]))
}

// Cruza ads_weekly (qb_code_detected) + cards + ad_lifecycle → filas lifecycle
// atribuidas, con su QB y su editor. Misma lógica que my_attributed_codes() en SQL.
export function attributeLifecycle(lifecycle, ads, qbToEditor) {
  const codeToQb = {}
  for (const a of ads || []) {
    if (a.qb_code_detected && qbToEditor[a.qb_code_detected]) codeToQb[a.ad_code] = a.qb_code_detected
  }
  return (lifecycle || []).filter((l) => codeToQb[l.code])
    .map((l) => ({ ...l, qb: codeToQb[l.code], editor: qbToEditor[codeToQb[l.code]] }))
}
