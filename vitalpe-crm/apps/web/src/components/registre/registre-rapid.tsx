'use client';

import { useRef, useState, useTransition } from 'react';
import { applyProposal, discardProposal, interpretAudio, interpretText } from '@/lib/actions/voice';
import { ClientPicker } from '@/components/client-picker';

interface Action {
  type: string;
  [key: string]: unknown;
}

interface Proposal {
  actions: Action[];
  ambiguities: { field: string; question: string; options?: string[] }[];
  confidence: number;
  summary: string;
  provider: string;
  model?: string;
}

type Mode = 'text' | 'veu';

/**
 * Capture → preview → confirm.
 *
 * The preview is not a formality: every proposed action can be excluded or
 * edited, ambiguities must be resolved by hand, and nothing is written until
 * CONFIRMAR I DESAR ELS CANVIS is pressed.
 */
export function RegistreRapid({
  selectedClientId,
  selectedClientName,
  interpreterName,
}: {
  selectedClientId: string | null;
  selectedClientName: string | null;
  interpreterName: string;
}) {
  const [mode, setMode] = useState<Mode>('text');
  const [clientId, setClientId] = useState(selectedClientId ?? '');
  const [clientName, setClientName] = useState(selectedClientName ?? '');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [voiceNoteId, setVoiceNoteId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [dropped, setDropped] = useState<{ reason: string }[]>([]);
  const [included, setIncluded] = useState<boolean[]>([]);
  const [applied, setApplied] = useState<string[] | null>(null);

  // --- recording -----------------------------------------------------------
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const duration = (Date.now() - startedAtRef.current) / 1000;
        void send(blob, duration);
      };
      startedAtRef.current = Date.now();
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError(
        "No s'ha pogut accedir al micròfon. Revisa els permisos del navegador o escriu el text a mà.",
      );
    }
  }

  function stopRecording(cancel = false) {
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (cancel) {
      recorder.onstop = () => recorder.stream.getTracks().forEach((t) => t.stop());
    }
    recorder.stop();
    recorderRef.current = null;
  }

  function send(blob: Blob, duration: number) {
    const fd = new FormData();
    fd.set('audio', new File([blob], 'nota.webm', { type: blob.type }));
    fd.set('clientId', clientId);
    fd.set('duration', String(Math.round(duration)));
    startTransition(async () => {
      const res = await interpretAudio(fd);
      handleResult(res);
    });
  }

  function handleResult(res: Awaited<ReturnType<typeof interpretText>>) {
    if (!res.ok) {
      setError(res.error ?? 'No s\'ha pogut interpretar.');
      return;
    }
    setError(null);
    setVoiceNoteId(res.voiceNoteId ?? null);
    setTranscript(res.transcript ?? '');
    const p = res.proposal as Proposal | undefined;
    setProposal(p ?? null);
    setDropped(res.dropped ?? []);
    setIncluded((p?.actions ?? []).map(() => true));
    setApplied(null);
  }

  function submitText() {
    const fd = new FormData();
    fd.set('text', text);
    fd.set('clientId', clientId);
    fd.set('origin', 'REGISTRE RÀPID');
    startTransition(async () => handleResult(await interpretText(fd)));
  }

  function confirm() {
    if (!proposal || !voiceNoteId) return;
    const kept = proposal.actions.filter((_, i) => included[i]);
    const fd = new FormData();
    fd.set('voiceNoteId', voiceNoteId);
    fd.set('actions', JSON.stringify(kept));
    startTransition(async () => {
      const res = await applyProposal(fd);
      if (res.ok) {
        setApplied(res.summary ?? []);
        setProposal(null);
        setText('');
      } else {
        setError(res.error ?? 'No s\'ha pogut desar.');
      }
    });
  }

  function discard() {
    if (!voiceNoteId) return;
    const fd = new FormData();
    fd.set('voiceNoteId', voiceNoteId);
    startTransition(async () => {
      await discardProposal(fd);
      setProposal(null);
      setVoiceNoteId(null);
      setTranscript('');
    });
  }

  return (
    <div className="grid gap-4">
      <section className="targeta p-4 grid gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <ClientPicker
              name="clientId"
              label="EMPRESA"
              value={clientId}
              initialLabel={selectedClientName}
              emptyLabel="Sense empresa (la diré al text)"
              onChange={(id, label) => {
                setClientId(id);
                setClientName(label);
              }}
            />
          </div>
          <div className="flex gap-1" role="tablist" aria-label="Mode de captura">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'text'}
              className={`boto ${mode === 'text' ? 'boto-principal' : ''}`}
              onClick={() => setMode('text')}
            >
              TEXT
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'veu'}
              className={`boto ${mode === 'veu' ? 'boto-principal' : ''}`}
              onClick={() => setMode('veu')}
            >
              VEU
            </button>
          </div>
        </div>

        {mode === 'text' ? (
          <>
            <label className="grid gap-1">
              <span className="etiqueta">QUÈ HA PASSAT</span>
              <textarea
                className="camp"
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="He parlat amb Gramona. Ja tenen proveïdor, però volen valorar xarel·lo ecològic per al 2027. Trucar l'octubre amb prioritat alta."
              />
            </label>
            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                className="boto boto-principal"
                disabled={pending || text.trim().length < 3}
                onClick={submitText}
              >
                {pending ? 'INTERPRETANT…' : 'INTERPRETAR'}
              </button>
              <span className="text-[11px] text-[var(--color-ink-faint)]">
                Intèrpret: {interpreterName}
              </span>
            </div>
          </>
        ) : (
          <div className="grid gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              {!recording ? (
                <button type="button" className="boto boto-principal" onClick={startRecording} disabled={pending}>
                  ● GRAVAR
                </button>
              ) : (
                <>
                  <button type="button" className="boto boto-principal" onClick={() => stopRecording(false)}>
                    ■ ATURAR I INTERPRETAR
                  </button>
                  <button type="button" className="boto" onClick={() => stopRecording(true)}>
                    CANCEL·LAR
                  </button>
                  <span className="font-mono tabular-nums text-[15px]" aria-live="polite">
                    {String(Math.floor(seconds / 60)).padStart(2, '0')}:
                    {String(seconds % 60).padStart(2, '0')}
                  </span>
                </>
              )}
              {pending && <span className="text-[13px]">Processant l&apos;àudio…</span>}
            </div>
            <label className="grid gap-1">
              <span className="etiqueta">O ENGANXA LA TRANSCRIPCIÓ</span>
              <textarea
                className="camp"
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Enganxa aquí el text si prefereixes no gravar, o si la transcripció automàtica no està configurada."
              />
              <button
                type="button"
                className="boto mt-1 justify-self-start"
                disabled={pending || text.trim().length < 3}
                onClick={submitText}
              >
                INTERPRETAR EL TEXT
              </button>
            </label>
          </div>
        )}

        {error && <p className="error-camp m-0">{error}</p>}
      </section>

      {applied && (
        <section className="targeta p-4 border-l-[3px] border-l-[var(--color-ok)]">
          <p className="etiqueta m-0 mb-1">CANVIS DESATS</p>
          <ul className="list-disc pl-5 m-0 text-[13px]">
            {applied.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {proposal && (
        <section className="targeta p-4 grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="etiqueta m-0">PREVISUALITZACIÓ — REVISA ABANS DE DESAR</h2>
            <span
              className={`estat ${
                proposal.confidence >= 0.75
                  ? 'estat-ok'
                  : proposal.confidence >= 0.5
                    ? 'estat-neutre'
                    : 'estat-avis'
              }`}
            >
              CONFIANÇA {Math.round(proposal.confidence * 100)}%
            </span>
          </div>

          <div className="grid gap-1 text-[13px]">
            <p className="m-0">
              <span className="etiqueta">EMPRESA</span>{' '}
              {clientName ?? <em className="text-[var(--color-ink-faint)]">detectada al text</em>}
            </p>
            <p className="m-0">
              <span className="etiqueta">TRANSCRIPCIÓ</span> {transcript}
            </p>
            {proposal.summary && (
              <p className="m-0">
                <span className="etiqueta">RESUM</span> {proposal.summary}
              </p>
            )}
          </div>

          {proposal.ambiguities.length > 0 && (
            <div className="border border-[var(--color-warn)] rounded-[var(--radius-sm)] p-3 bg-[var(--color-warn-wash)]">
              <p className="etiqueta m-0 mb-1">AMBIGÜITATS — CAL DECIDIR-HO TU</p>
              <ul className="m-0 pl-5 text-[13px]">
                {proposal.ambiguities.map((a) => (
                  <li key={`${a.field}-${a.question}`}>
                    <strong>{a.field}:</strong> {a.question}
                    {a.options && a.options.length > 0 && ` (${a.options.join(' / ')})`}
                  </li>
                ))}
              </ul>
              <p className="text-[12px] m-0 mt-1 text-[var(--color-ink-soft)]">
                No s&apos;ha inventat cap valor. Edita l&apos;acció o desa-la sense data.
              </p>
            </div>
          )}

          {dropped.length > 0 && (
            <div className="text-[12px] text-[var(--color-ink-soft)]">
              <p className="etiqueta m-0">ACCIONS DESCARTADES AUTOMÀTICAMENT</p>
              <ul className="m-0 pl-5">
                {dropped.map((d) => (
                  <li key={d.reason}>{d.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {proposal.actions.length === 0 ? (
            <p className="text-[13px] m-0">
              No s&apos;ha detectat cap acció concreta. Pots afegir la nota manualment des de la
              fitxa de l&apos;empresa.
            </p>
          ) : (
            <ul className="list-none p-0 m-0 grid gap-2">
              {proposal.actions.map((action, i) => (
                <li
                  key={`${action.type}-${i}`}
                  className="border border-[var(--color-line)] rounded-[var(--radius-sm)] p-3"
                >
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={included[i] ?? true}
                      onChange={(e) => {
                        const next = [...included];
                        next[i] = e.target.checked;
                        setIncluded(next);
                      }}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="estat estat-marca">{action.type.replace(/_/g, ' ')}</span>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-[2px] m-0 mt-2 text-[13px]">
                        {Object.entries(action)
                          .filter(([k]) => k !== 'type')
                          .map(([k, v]) => (
                            <div key={k} className="contents">
                              <dt className="etiqueta">{k.toUpperCase()}</dt>
                              <dd className="m-0 break-words">
                                {typeof v === 'object' && v !== null
                                  ? Object.values(v as Record<string, unknown>)
                                      .filter(Boolean)
                                      .join(' · ')
                                  : String(v)}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="boto boto-principal"
              disabled={pending || included.every((v) => !v)}
              onClick={confirm}
            >
              {pending ? 'DESANT…' : 'CONFIRMAR I DESAR ELS CANVIS'}
            </button>
            <button type="button" className="boto" onClick={discard} disabled={pending}>
              DESCARTAR
            </button>
          </div>
          <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
            La classificació d&apos;una empresa mai es confirma automàticament: una proposta de
            classificació es desa com a nota i l&apos;has de confirmar tu a la fitxa.
          </p>
        </section>
      )}
    </div>
  );
}
