'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export type ServerAction = (formData: FormData) => Promise<ActionResult>;

/**
 * One form wrapper for every server action on a company card.
 *
 * It keeps the three things that must always happen in the same place: the
 * submit button is disabled while the action runs, a refusal from the database
 * is shown next to the form instead of throwing, and the form only resets when
 * the write actually succeeded.
 */
export function AccioForm({
  action,
  children,
  submitLabel = 'DESAR',
  pendingLabel = 'DESANT…',
  onDone,
  onCancel,
  cancelLabel = 'CANCEL·LAR',
  resetOnSuccess = false,
  hidden = {},
  className = 'grid gap-3',
  submitClassName = 'boto boto-principal',
  confirmText,
}: {
  action: ServerAction;
  children?: React.ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  onDone?: () => void;
  onCancel?: (() => void) | undefined;
  cancelLabel?: string;
  resetOnSuccess?: boolean;
  hidden?: Record<string, string>;
  className?: string;
  submitClassName?: string;
  confirmText?: string;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmText && !window.confirm(confirmText)) return;
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await action(formData);
          if (result.ok) {
            if (resetOnSuccess) formRef.current?.reset();
            onDone?.();
          } else {
            setError(result.error ?? 'No s’ha pogut desar. Torna-ho a provar.');
          }
        });
      }}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {error && (
        <p className="error-camp m-0" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2 flex-wrap">
        <button type="submit" className={submitClassName} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="boto" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </button>
        )}
      </div>
    </form>
  );
}

/** A labelled field. The label is always tied to its control. */
export function Camp({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <label className={`grid gap-1 ${className}`}>
      <span className="etiqueta">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--color-ink-faint)]">{hint}</span>}
    </label>
  );
}

/**
 * Side panel. Sectioned forms live here rather than in a full-screen modal, so
 * the record stays visible behind them.
 */
export function Panell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [tabindex]',
    )?.focus();
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Tancar el panell"
        className="absolute inset-0 bg-[rgba(28,26,25,0.35)] border-0 cursor-pointer"
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-[480px] h-full overflow-y-auto bg-[var(--color-paper)] border-l border-[var(--color-line-strong)] p-4 md:p-5 grid gap-4 content-start"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold m-0">{title}</h2>
            {subtitle && (
              <p className="text-[12px] text-[var(--color-ink-faint)] m-0">{subtitle}</p>
            )}
          </div>
          <button type="button" className="boto" onClick={onClose}>
            TANCAR
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
