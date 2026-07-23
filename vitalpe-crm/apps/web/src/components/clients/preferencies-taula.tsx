'use client';

import { useState } from 'react';
import { saveTablePreferences } from '@/lib/actions/clients';
import { AccioForm, Panell } from './accio-form';

/**
 * Visible columns and row density. Stored in a cookie by a server action, so
 * the choice survives a reload and stays out of the shareable filter URL.
 */
export function PreferenciesTaula({
  columns,
  visible,
  density,
}: {
  columns: { key: string; label: string }[];
  visible: string[];
  density: 'normal' | 'compacta';
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const chosen = new Set(visible);

  return (
    <>
      <button type="button" className="boto" onClick={() => setOpen(true)}>
        COLUMNES I DENSITAT
      </button>
      {open && (
        <Panell
          title="COLUMNES I DENSITAT"
          subtitle="La tria es recorda en aquest navegador."
          onClose={() => setOpen(false)}
        >
          <AccioForm
            action={saveTablePreferences}
            submitLabel="APLICAR"
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          >
            <fieldset className="border border-[var(--color-line)] rounded-[var(--radius-sm)] p-3 m-0 grid gap-2">
              <legend className="etiqueta px-1">COLUMNES</legend>
              <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
                La columna EMPRESA sempre es mostra.
              </p>
              {columns.map((column) => (
                <label key={column.key} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    name="columna"
                    value={column.key}
                    defaultChecked={chosen.has(column.key)}
                  />
                  {column.label}
                </label>
              ))}
            </fieldset>

            <fieldset className="border border-[var(--color-line)] rounded-[var(--radius-sm)] p-3 m-0 grid gap-2">
              <legend className="etiqueta px-1">DENSITAT</legend>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="radio" name="densitat" value="normal" defaultChecked={density === 'normal'} />
                NORMAL
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="radio"
                  name="densitat"
                  value="compacta"
                  defaultChecked={density === 'compacta'}
                />
                COMPACTA
              </label>
            </fieldset>
          </AccioForm>
        </Panell>
      )}
    </>
  );
}
