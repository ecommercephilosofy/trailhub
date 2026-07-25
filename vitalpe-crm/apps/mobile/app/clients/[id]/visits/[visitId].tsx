/**
 * A single visit — the other deep-link target.
 *
 * Google Calendar events carry a link to this route, so it has to open cleanly
 * from outside the app with nothing but two ids. It reads the cache, and says
 * so plainly when the visit is not in it rather than pretending to load
 * forever.
 */
import { View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../../../../src/runtime/session';
import { Body, Button, Card, Chip, Faint, Label, Row, Screen, Title } from '../../../../src/ui/kit';
import { formatDate, formatTimeRange } from '../../../../src/core/format';
import { VISIT_TONE, toneFor, space } from '../../../../src/core/theme';
import { isUuid } from '../../../../src/core/deepLinks';

export default function VisitScreen() {
  const { id, visitId } = useLocalSearchParams<{ id: string; visitId: string }>();
  const { ready, session, cache } = useSession();
  const router = useRouter();

  if (!ready) return null;
  if (session === null) return <Redirect href="/entrar" />;

  const clientId = typeof id === 'string' ? id.toLowerCase() : '';
  const wanted = typeof visitId === 'string' ? visitId.toLowerCase() : '';

  if (!isUuid(clientId) || !isUuid(wanted)) {
    return (
      <Screen>
        <Card>
          <Label>ENLLAÇ NO VÀLID</Label>
          <Body soft>Aquesta adreça no correspon a cap visita.</Body>
        </Card>
      </Screen>
    );
  }

  const visit = cache.visits.find((v) => v.id === wanted) ?? null;
  const client = cache.clients.find((c) => c.id === clientId) ?? null;

  return (
    <Screen>
      {visit === null ? (
        <Card>
          <Label>VISITA NO DISPONIBLE</Label>
          <Body soft>
            Aquesta visita no és a la còpia local del telèfon. Actualitza des d&apos;AVUI quan
            tinguis connexió.
          </Body>
          <View style={{ height: space.xs }} />
          <Button onPress={() => router.replace(`/clients/${clientId}`)}>OBRIR LA FITXA</Button>
        </Card>
      ) : (
        <>
          <View>
            <Title>{visit.clientName || client?.name || 'Visita'}</Title>
            <Faint>{formatDate(visit.startsAt)}</Faint>
            <View style={{ height: space.xs }} />
            <Row>
              <Chip tone={toneFor(VISIT_TONE, visit.status)}>{visit.status}</Chip>
            </Row>
          </View>

          <Card>
            <Label>HORARI</Label>
            <Body>{formatTimeRange(visit.startsAt, visit.endsAt)}</Body>
          </Card>

          {visit.objective !== null && (
            <Card>
              <Label>OBJECTIU</Label>
              <Body>{visit.objective}</Body>
            </Card>
          )}

          <Card>
            <Label>REGISTRAR</Label>
            <Body soft>
              Explica com ha anat i el CRM proposarà les accions. Res es desa sense que ho
              confirmis.
            </Body>
            <View style={{ height: space.xs }} />
            <Row>
              <Button variant="primary" onPress={() => router.push(`/registre?client=${clientId}`)}>
                NOTA DE VEU
              </Button>
              <Button onPress={() => router.push(`/clients/${clientId}`)}>FITXA</Button>
            </Row>
          </Card>
        </>
      )}
    </Screen>
  );
}
