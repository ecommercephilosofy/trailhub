/**
 * Sign in — e-mail and password, matching the web app.
 *
 * There is no sign-up and no password reset here: accounts are created by an
 * administrator. A field app that could create accounts would be a way into the
 * customer list.
 */
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Label } from '../src/ui/kit';
import { useSession } from '../src/runtime/session';
import { colors, radius, space, typography, MIN_TOUCH_TARGET } from '../src/core/theme';

export default function EntrarScreen() {
  const { signIn, configured } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await signIn(email, password);
    if (!result.ok) setError(result.error ?? 'No s\'ha pogut entrar.');
    setBusy(false);
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.wrap}>
        <View style={{ gap: space.xs }}>
          <Label>CRM COMERCIAL</Label>
          <Text style={s.brand}>VITALPE</Text>
          <Text style={s.tagline}>Vi a granel, base cava, DO Penedès i most.</Text>
        </View>

        <Card>
          <Label>CORREU</Label>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="nom@empresa.com"
            placeholderTextColor={colors.inkFaint}
          />
          <View style={{ height: space.sm }} />
          <Label>CONTRASENYA</Label>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            placeholder="••••••••"
            placeholderTextColor={colors.inkFaint}
          />
          {error !== null && <Text style={s.error}>{error}</Text>}
          <View style={{ height: space.sm }} />
          <Button variant="primary" onPress={submit} disabled={busy || !configured}>
            {busy ? 'ENTRANT…' : 'ENTRAR'}
          </Button>
          {!configured && (
            <Text style={s.notice}>
              Aquesta compilació no porta les credencials del servidor. Cal definir
              EXPO_PUBLIC_SUPABASE_URL i EXPO_PUBLIC_SUPABASE_ANON_KEY.
            </Text>
          )}
        </Card>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  wrap: { flex: 1, justifyContent: 'center', padding: space.lg, gap: space.lg },
  brand: { fontSize: 30, fontWeight: '700', color: colors.burgundy, letterSpacing: -0.5 },
  tagline: { ...typography.body, color: colors.inkSoft },
  input: {
    ...typography.input,
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    color: colors.ink,
    backgroundColor: colors.paperRaised,
  },
  error: { ...typography.bodySmall, color: colors.danger, marginTop: space.sm },
  notice: { ...typography.bodySmall, color: colors.inkFaint, marginTop: space.sm },
});
