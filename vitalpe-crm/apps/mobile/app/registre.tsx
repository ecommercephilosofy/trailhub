/**
 * REGISTRE — dictate or type what happened, then confirm.
 *
 * The phone records and uploads; it never decides. The recording is sent to the
 * web app's own voice endpoint, which transcribes, interprets and returns a
 * PROPOSAL. Nothing is written to the CRM until the person taps CONFIRMAR on
 * the preview — the same rule as the web, enforced in the same place.
 *
 * If transcription is not configured on the server, the typed-text path still
 * works end to end. That is deliberate: a commercial in a cellar with no
 * transcription credential can still record what happened.
 */
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { useSession } from '../src/runtime/session';
import { Body, Button, Card, Empty, Faint, Label, Row, Screen, Title } from '../src/ui/kit';
import { colors, radius, space, typography } from '../src/core/theme';
import { API_URL } from '../src/runtime/supabase';
import { supabase } from '../src/runtime/supabase';

interface ProposalAction {
  type: string;
  [key: string]: unknown;
}

export default function RegistreScreen() {
  const { client } = useLocalSearchParams<{ client?: string }>();
  const { ready, session, cache } = useSession();
  const router = useRouter();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actions, setActions] = useState<ProposalAction[] | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [kept, setKept] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<string[] | null>(null);

  if (!ready) return null;
  if (session === null) return <Redirect href="/entrar" />;

  const clientId = typeof client === 'string' ? client : null;
  const clientName = cache.clients.find((c) => c.id === clientId)?.name ?? null;

  async function authedFetch(path: string, body: FormData): Promise<Response> {
    const { data } = await supabase().auth.getSession();
    const token = data.session?.access_token ?? '';
    return fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
  }

  async function startRecording(): Promise<void> {
    setError(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError('Cal permís de micròfon per gravar. Actívalo als ajustos del telèfon.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    recorder.record();
  }

  async function stopAndSend(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri === null) throw new Error('No s\'ha pogut llegir la gravació.');
      const form = new FormData();
      // React Native's FormData takes the file by reference; the bytes never
      // pass through JavaScript, which is what keeps a long note from blowing
      // the heap.
      form.append('audio', { uri, name: 'nota.m4a', type: 'audio/m4a' } as unknown as Blob);
      if (clientId !== null) form.append('clientId', clientId);
      const response = await authedFetch('/api/veu/interpretar', form);
      await handleProposal(response);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendText(): Promise<void> {
    if (text.trim().length < 3) {
      setError('Escriu què ha passat.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('text', text);
      if (clientId !== null) form.append('clientId', clientId);
      const response = await authedFetch('/api/veu/interpretar', form);
      await handleProposal(response);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleProposal(response: Response): Promise<void> {
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      voiceNoteId?: string;
      transcript?: string;
      proposal?: { actions?: ProposalAction[] };
    };
    if (payload.ok !== true) throw new Error(payload.error ?? 'No s\'ha pogut interpretar.');
    if (payload.transcript !== undefined) setText(payload.transcript);
    const list = payload.proposal?.actions ?? [];
    setActions(list);
    setNoteId(payload.voiceNoteId ?? null);
    // Everything starts ticked; the person unticks what they do not want.
    setKept(new Set(list.map((_, i) => i)));
  }

  async function confirm(): Promise<void> {
    if (actions === null || noteId === null) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('voiceNoteId', noteId);
      form.append('actions', JSON.stringify(actions.filter((_, i) => kept.has(i))));
      const response = await authedFetch('/api/veu/aplicar', form);
      const payload = (await response.json()) as { ok?: boolean; error?: string; summary?: string[] };
      if (payload.ok !== true) throw new Error(payload.error ?? 'No s\'ha pogut desar.');
      setDone(payload.summary ?? []);
      setActions(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View>
        <Title>REGISTRE</Title>
        <Faint>{clientName ?? 'Sense empresa: digues-la dins del text.'}</Faint>
      </View>

      {done !== null ? (
        <Card>
          <Label>DESAT</Label>
          {done.length === 0 ? <Empty>Res a desar.</Empty> : done.map((line) => <Body key={line}>{line}</Body>)}
          <View style={{ height: space.xs }} />
          <Button variant="primary" onPress={() => router.back()}>
            TORNAR
          </Button>
        </Card>
      ) : (
        <>
          <Card>
            <Label>VEU</Label>
            <Row>
              {recorder.isRecording ? (
                <Button variant="primary" onPress={() => void stopAndSend()} disabled={busy}>
                  {busy ? 'ENVIANT…' : 'ATURAR I ENVIAR'}
                </Button>
              ) : (
                <Button onPress={() => void startRecording()} disabled={busy}>
                  GRAVAR
                </Button>
              )}
            </Row>
            {recorder.isRecording && <Faint>Gravant… parla amb naturalitat.</Faint>}
          </Card>

          <Card>
            <Label>O ESCRIU-HO</Label>
            <TextInput
              style={s.area}
              value={text}
              onChangeText={setText}
              multiline
              placeholder="He parlat amb… demanen preus… truca'm el 5 d'octubre…"
              placeholderTextColor={colors.inkFaint}
            />
            <View style={{ height: space.xs }} />
            <Button onPress={() => void sendText()} disabled={busy}>
              {busy ? 'INTERPRETANT…' : 'INTERPRETAR'}
            </Button>
          </Card>

          {error !== null && (
            <Card>
              <Label>NO S&apos;HA POGUT FER</Label>
              <Text style={s.error}>{error}</Text>
              <Faint>La gravació no s&apos;ha perdut: pots tornar-ho a provar.</Faint>
            </Card>
          )}

          {actions !== null && (
            <Card>
              <Label>REVISA ABANS DE DESAR ({actions.length})</Label>
              {actions.length === 0 ? (
                <Empty>No s&apos;ha entès cap acció concreta.</Empty>
              ) : (
                actions.map((action, index) => (
                  <View key={`${action.type}-${index}`} style={s.action}>
                    <Body>{action.type}</Body>
                    <Button
                      onPress={() => {
                        const next = new Set(kept);
                        if (next.has(index)) next.delete(index);
                        else next.add(index);
                        setKept(next);
                      }}
                    >
                      {kept.has(index) ? 'INCLOSA' : 'EXCLOSA'}
                    </Button>
                  </View>
                ))
              )}
              <View style={{ height: space.xs }} />
              <Row>
                <Button variant="primary" onPress={() => void confirm()} disabled={busy || kept.size === 0}>
                  CONFIRMAR I DESAR
                </Button>
                <Button onPress={() => setActions(null)}>DESCARTAR</Button>
              </Row>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  area: {
    ...typography.input,
    minHeight: 110,
    textAlignVertical: 'top',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    borderRadius: radius.sm,
    padding: space.md,
    color: colors.ink,
    backgroundColor: colors.paperRaised,
  },
  error: { ...typography.bodySmall, color: colors.danger },
  action: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
  },
});
