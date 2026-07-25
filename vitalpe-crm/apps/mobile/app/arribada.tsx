/**
 * The arrival chooser.
 *
 * Reached from an ambiguous arrival notification: several of our companies
 * share this spot and the app refuses to guess. The candidates arrive as ids in
 * the query string — never names — so the notification that led here leaked
 * nothing, and the names are looked up locally once the app is open and the
 * user has unlocked the phone.
 */
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '../src/runtime/session';
import { Body, Button, Card, Empty, Faint, Label, Screen, Title } from '../src/ui/kit';
import { parseArrivalCandidates } from '../src/core/deepLinks';
import { space } from '../src/core/theme';

export default function ArribadaScreen() {
  const { candidats } = useLocalSearchParams<{ candidats?: string }>();
  const { ready, session, cache } = useSession();
  const router = useRouter();

  if (!ready) return null;
  if (session === null) return <Redirect href="/entrar" />;

  const target = parseArrivalCandidates(typeof candidats === 'string' ? candidats : null);
  const candidates = target !== null && target.kind === 'ARRIBADA' ? target.candidates : [];

  return (
    <Screen>
      <View>
        <Title>ON ETS?</Title>
        <Faint>
          Hi ha més d&apos;una empresa en aquest punt. Tria-la tu: l&apos;app no n&apos;endevina cap.
        </Faint>
      </View>

      {candidates.length === 0 ? (
        <Card>
          <Label>SENSE CANDIDATS</Label>
          <Empty>Aquest avís ja no és vàlid.</Empty>
          <View style={{ height: space.xs }} />
          <Button onPress={() => router.replace('/')}>ANAR A AVUI</Button>
        </Card>
      ) : (
        candidates.map((candidate) => {
          const client = cache.clients.find((c) => c.id === candidate.clientId) ?? null;
          return (
            <Card key={`${candidate.clientId}-${candidate.locationId}`}>
              <Body>{client?.name ?? 'Empresa fora de la còpia local'}</Body>
              {client?.municipality != null && <Faint>{client.municipality}</Faint>}
              <View style={{ height: space.xs }} />
              <Button
                variant="primary"
                onPress={() => router.replace(`/clients/${candidate.clientId}`)}
              >
                ÉS AQUESTA
              </Button>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
