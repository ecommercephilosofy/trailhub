'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reassignTask } from './actions';

/**
 * Inline reassignment. Manager-only; a COMERCIAL never sees this control and
 * would be refused by RLS even if they did.
 */
export function AssigneeSelect({
  taskId,
  value,
  options,
}: {
  taskId: string;
  value: string | null;
  options: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="grid gap-1">
      <select
        className="camp min-w-[150px]"
        value={current}
        disabled={pending}
        aria-label="Comercial assignat"
        onChange={(e) => {
          const next = e.target.value;
          const previous = current;
          setCurrent(next);
          setError(null);
          startTransition(async () => {
            const fd = new FormData();
            fd.set('taskId', taskId);
            fd.set('assignedTo', next);
            const result = await reassignTask(fd);
            if (result.ok) router.refresh();
            else {
              setCurrent(previous);
              setError(result.error ?? 'No s’ha pogut reassignar.');
            }
          });
        }}
      >
        <option value="">SENSE ASSIGNAR</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {error && <span className="error-camp">{error}</span>}
    </span>
  );
}
