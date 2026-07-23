'use client';

import { useState, useTransition } from 'react';
import {
  changeRole,
  inviteUser,
  resendInvitation,
  revokeInvitation,
  setMembershipStatus,
  type InviteData,
} from '@/lib/actions/users';
import { AccioBoto } from './accions';

const ROLES = ['ADMIN', 'GERENT', 'COMERCIAL'] as const;

const ROLE_HELP: Record<string, string> = {
  ADMIN: 'Tot, incloent-hi rols, catàleg, importacions i fusions.',
  GERENT: 'Veu i edita la feina de tot l’equip; no toca rols ni catàleg.',
  COMERCIAL: 'Treballa amb les empreses que té assignades.',
};

/** Shows an invitation link once it exists, with a copy button. */
function Enllac({ data }: { data: InviteData }) {
  const [copiat, setCopiat] = useState(false);
  return (
    <div className="targeta p-3 grid gap-2 border-l-[3px] border-l-[var(--color-burgundy)]">
      <p className="etiqueta m-0">INVITACIÓ CREADA · {data.email}</p>
      <p className="text-[13px] m-0">
        No hi ha cap proveïdor de correu configurat en aquest entorn, per tant el CRM{' '}
        <strong>no envia res</strong>. Copia aquest enllaç i fes-lo arribar tu a la persona. És
        l’única vegada que es mostra: el CRM en desa només el resum criptogràfic.
      </p>
      <code className="text-[12px] break-all bg-[var(--color-paper-sunken)] p-2 rounded-[var(--radius-sm)]">
        {data.link}
      </code>
      <div className="flex gap-2 items-center">
        <button
          type="button"
          className="boto"
          onClick={() => {
            void navigator.clipboard?.writeText(data.link).then(() => setCopiat(true));
          }}
        >
          {copiat ? 'COPIAT' : 'COPIAR ENLLAÇ'}
        </button>
        <span className="text-[12px] text-[var(--color-ink-faint)]">
          Caduca el {new Date(data.expiresAt).toLocaleDateString('ca-ES')}
        </span>
      </div>
    </div>
  );
}

export function ConvidarFormulari() {
  const [role, setRole] = useState<string>('COMERCIAL');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InviteData | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="grid gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        action={(fd) =>
          start(async () => {
            setError(null);
            const res = await inviteUser(fd);
            if (res.ok && res.data) setData(res.data);
            else setError(res.error ?? 'No s’ha pogut convidar.');
          })
        }
      >
        <label className="grid gap-1">
          <span className="etiqueta">CORREU</span>
          <input className="camp min-w-[240px]" type="email" name="email" required />
        </label>
        <label className="grid gap-1">
          <span className="etiqueta">ROL</span>
          <select
            className="camp min-w-[160px]"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button className="boto boto-principal" type="submit" disabled={pending}>
          {pending ? 'CREANT…' : 'CREAR INVITACIÓ'}
        </button>
      </form>
      <p className="text-[12px] text-[var(--color-ink-faint)] m-0">{ROLE_HELP[role]}</p>
      {error && <p className="error-camp m-0">{error}</p>}
      {data && <Enllac data={data} />}
    </div>
  );
}

export function ReenviarBoto({ id }: { id: string }) {
  const [data, setData] = useState<InviteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2">
      <div className="flex gap-1 flex-wrap">
        <button
          type="button"
          className="boto"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const fd = new FormData();
              fd.set('id', id);
              const res = await resendInvitation(fd);
              if (res.ok && res.data) setData(res.data);
              else setError(res.error ?? 'No s’ha pogut reenviar.');
            })
          }
        >
          {pending ? 'GENERANT…' : 'NOU ENLLAÇ'}
        </button>
        <AccioBoto
          accio={revokeInvitation}
          camps={{ id }}
          etiqueta="REVOCAR"
          variant="perill"
          titol="La invitació deixa de ser vàlida immediatament."
        />
      </div>
      {error && <p className="error-camp m-0">{error}</p>}
      {data && <Enllac data={data} />}
    </div>
  );
}

export function CanviRol({
  userId,
  actual,
  esTuMateix,
}: {
  userId: string;
  actual: string;
  esTuMateix: boolean;
}) {
  const [role, setRole] = useState(actual);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (esTuMateix) {
    return (
      <span className="text-[12px] text-[var(--color-ink-faint)]">
        El teu propi rol el canvia un altre ADMIN.
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex gap-1 items-center">
        <select
          className="camp w-[130px]"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          aria-label="Rol"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="boto"
          disabled={pending || role === actual}
          onClick={() =>
            start(async () => {
              setError(null);
              const fd = new FormData();
              fd.set('userId', userId);
              fd.set('role', role);
              const res = await changeRole(fd);
              if (!res.ok) {
                setError(res.error ?? 'No s’ha pogut canviar.');
                setRole(actual);
              }
            })
          }
        >
          {pending ? 'DESANT…' : 'APLICAR'}
        </button>
      </span>
      {error && <span className="error-camp">{error}</span>}
    </span>
  );
}

export function CanviEstat({
  userId,
  actiu,
  nom,
  esTuMateix,
}: {
  userId: string;
  actiu: boolean;
  nom: string;
  esTuMateix: boolean;
}) {
  const [obert, setObert] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (esTuMateix) {
    return <span className="text-[12px] text-[var(--color-ink-faint)]">—</span>;
  }

  if (actiu && !obert) {
    return (
      <button type="button" className="boto boto-perill" onClick={() => setObert(true)}>
        DESACTIVAR
      </button>
    );
  }

  if (!actiu) {
    return (
      <AccioBoto
        accio={setMembershipStatus}
        camps={{ userId, status: 'ACTIU' }}
        etiqueta="REACTIVAR"
        titol="Torna a donar accés amb el mateix rol."
      />
    );
  }

  return (
    <div className="targeta p-3 grid gap-2 max-w-[380px] border-l-[3px] border-l-[var(--color-danger)]">
      <p className="etiqueta m-0">DESACTIVAR {nom.toUpperCase()}</p>
      <p className="text-[13px] m-0 text-[var(--color-ink-soft)]">
        Perdrà l’accés immediatament. No s’esborra res: les seves empreses, tasques i historial es
        mantenen tal com estan i el seu nom continua sortint a l’auditoria.
      </p>
      <p className="text-[12px] m-0">
        <span className="etiqueta">REVERSIBLE</span> Sí, amb REACTIVAR.
      </p>
      {error && <p className="error-camp m-0">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="boto boto-perill"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const fd = new FormData();
              fd.set('userId', userId);
              fd.set('status', 'DESACTIVAT');
              const res = await setMembershipStatus(fd);
              if (res.ok) setObert(false);
              else setError(res.error ?? 'No s’ha pogut desactivar.');
            })
          }
        >
          {pending ? 'DESACTIVANT…' : 'DESACTIVAR'}
        </button>
        <button type="button" className="boto" onClick={() => setObert(false)} disabled={pending}>
          CANCEL·LAR
        </button>
      </div>
    </div>
  );
}
