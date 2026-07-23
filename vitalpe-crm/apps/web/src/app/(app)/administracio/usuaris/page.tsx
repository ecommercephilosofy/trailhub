import { query, requireRole } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { expireInvitations } from '@/lib/actions/users';
import { AccioBoto } from '@/components/admin/accions';
import {
  CanviEstat,
  CanviRol,
  ConvidarFormulari,
  ReenviarBoto,
} from '@/components/admin/usuaris-client';

export const dynamic = 'force-dynamic';

/**
 * USUARIS — ADMIN only.
 *
 * `requireRole('ADMIN')` sends everybody else back to INICI, but that redirect
 * is convenience, not security: `memberships_admin_write` and
 * `invitations_admin_all` are the policies that actually decide, and their
 * WITH CHECK is evaluated against the new row, so a COMERCIAL replaying the
 * action cannot promote themselves. The screen says so out loud rather than
 * implying the buttons are the rule.
 */

interface MemberRow {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  status: string;
  is_active: boolean;
  activated_at: string | null;
  created_at: string;
  clients: string;
  pending_tasks: string;
}

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  invited_by: string | null;
  expired: boolean;
}

export default async function UsuarisPage() {
  const session = await requireRole('ADMIN');

  const data = await query(session, async (q) => {
    const [members, invitations] = await Promise.all([
      q.many<MemberRow>(
        `select m.user_id, p.email, p.first_name, p.last_name,
                m.role::text as role, m.status::text as status, p.is_active,
                m.activated_at, m.created_at,
                (select count(*)::text from public.clients c
                  where c.owner_id = p.id and c.workspace_id = $1 and c.deleted_at is null) as clients,
                (select count(*)::text from public.tasks t
                  where t.assigned_to = p.id and t.workspace_id = $1
                    and t.status = 'PENDENT' and t.deleted_at is null) as pending_tasks
           from public.workspace_memberships m
           join public.profiles p on p.id = m.user_id
          where m.workspace_id = $1
          order by case m.role when 'ADMIN' then 1 when 'GERENT' then 2 else 3 end, p.email`,
        [session.workspaceId],
      ),
      q.many<InvitationRow>(
        `select i.id, i.email, i.role::text as role, i.status::text as status,
                i.expires_at, i.created_at, i.accepted_at, i.revoked_at,
                nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') as invited_by,
                (i.status = 'PENDENT' and i.expires_at < now()) as expired
           from public.workspace_invitations i
           left join public.profiles p on p.id = i.invited_by
          where i.workspace_id = $1
          order by i.created_at desc`,
        [session.workspaceId],
      ),
    ]);
    return { members, invitations };
  });

  const expiredCount = data.invitations.filter((i) => i.expired).length;

  return (
    <div className="grid gap-6 max-w-[1100px]">
      <header>
        <p className="etiqueta m-0">ADMINISTRACIÓ</p>
        <h1 className="text-2xl font-semibold tracking-tight m-0">USUARIS</h1>
        <p className="text-[13px] text-[var(--color-ink-soft)] mt-1 mb-0">
          Qui té accés a l’espai VITALPE i amb quin rol.
        </p>
      </header>

      <section>
        <h2 className="etiqueta mb-2">MEMBRES ({data.members.length})</h2>
        <div className="taula-ampla targeta">
          <table className="taula">
            <thead>
              <tr>
                <th>PERSONA</th>
                <th>CORREU</th>
                <th>ROL</th>
                <th>ESTAT</th>
                <th className="text-right">EMPRESES</th>
                <th className="text-right">TASQUES PENDENTS</th>
                <th>ALTA</th>
                <th>CANVIAR ROL</th>
                <th>ACCÉS</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => {
                const name = [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email;
                const active = m.status === 'ACTIU' && m.is_active;
                const self = m.user_id === session.userId;
                return (
                  <tr key={m.user_id}>
                    <td className="font-semibold">
                      {name}
                      {self && <span className="etiqueta ml-2">TU</span>}
                    </td>
                    <td className="text-[var(--color-ink-soft)]">{m.email}</td>
                    <td>
                      <span className="estat estat-marca">{m.role}</span>
                    </td>
                    <td>
                      <span className={`estat ${active ? 'estat-ok' : 'estat-perill'}`}>
                        {active ? 'ACTIU' : m.status}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{m.clients}</td>
                    <td className="text-right tabular-nums">{m.pending_tasks}</td>
                    <td className="tabular-nums whitespace-nowrap">
                      {formatDate(m.activated_at ?? m.created_at)}
                    </td>
                    <td>
                      <CanviRol userId={m.user_id} actual={m.role} esTuMateix={self} />
                    </td>
                    <td>
                      <CanviEstat
                        userId={m.user_id}
                        actiu={active}
                        nom={name}
                        esTuMateix={self}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-[var(--color-ink-faint)] mt-2 mb-0">
          Desactivar és una baixa d’accés, no un esborrat: el perfil, les empreses assignades i tot
          el rastre a l’auditoria es conserven. El CRM no permet esborrar una persona.
        </p>
      </section>

      <section className="grid gap-3">
        <h2 className="etiqueta m-0">CONVIDAR UNA PERSONA</h2>
        <div className="targeta p-4">
          <ConvidarFormulari />
        </div>
      </section>

      <section>
        <h2 className="etiqueta mb-2 flex items-center gap-3">
          INVITACIONS ({data.invitations.length})
          {expiredCount > 0 && (
            <AccioBoto
              accio={expireInvitations}
              camps={{}}
              etiqueta={`MARCAR ${expiredCount} COM A CADUCADES`}
            />
          )}
        </h2>
        {data.invitations.length === 0 ? (
          <p className="text-[13px] text-[var(--color-ink-faint)] m-0">
            Cap invitació. Els tres usuaris inicials es van crear amb la importació.
          </p>
        ) : (
          <div className="taula-ampla targeta">
            <table className="taula">
              <thead>
                <tr>
                  <th>CORREU</th>
                  <th>ROL</th>
                  <th>ESTAT</th>
                  <th>CADUCA</th>
                  <th>CREADA</th>
                  <th>CONVIDADA PER</th>
                  <th>ACCIONS</th>
                </tr>
              </thead>
              <tbody>
                {data.invitations.map((i) => {
                  const state = i.expired ? 'CADUCADA' : i.status;
                  const tone =
                    state === 'ACCEPTADA'
                      ? 'estat-ok'
                      : state === 'PENDENT'
                        ? 'estat-neutre'
                        : state === 'CADUCADA'
                          ? 'estat-avis'
                          : 'estat-perill';
                  return (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td>
                        <span className="estat estat-marca">{i.role}</span>
                      </td>
                      <td>
                        <span className={`estat ${tone}`}>{state}</span>
                      </td>
                      <td className="tabular-nums whitespace-nowrap">{formatDateTime(i.expires_at)}</td>
                      <td className="tabular-nums whitespace-nowrap">{formatDate(i.created_at)}</td>
                      <td className="text-[var(--color-ink-soft)]">{i.invited_by ?? '—'}</td>
                      <td>
                        {i.status === 'PENDENT' || state === 'CADUCADA' ? (
                          <ReenviarBoto id={i.id} />
                        ) : (
                          <span className="text-[var(--color-ink-faint)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="targeta p-4 text-[13px] grid gap-2">
        <h2 className="etiqueta m-0">COM FUNCIONEN ELS PERMISOS</h2>
        <p className="m-0">
          El rol és un conjunt de permisos avaluat <strong>dins la base de dades</strong>, no en
          aquesta pantalla. Amagar un botó no és un permís: encara que algú reprodueixi aquesta acció
          des de fora, la política <code>memberships_admin_write</code> comprova que qui la fa sigui
          ADMIN de l’espai, i comprova també la fila resultant. Per això un COMERCIAL no es pot pujar
          el rol ni tan sols manipulant el formulari.
        </p>
        <p className="m-0">
          No hi ha cap proveïdor de correu configurat, així que el CRM no envia invitacions. Es
          desa el resum criptogràfic del testimoni (mai el testimoni) i l’enllaç es mostra una sola
          vegada, en crear-lo o en generar-ne un de nou.
        </p>
      </section>
    </div>
  );
}
