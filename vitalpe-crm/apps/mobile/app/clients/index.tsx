/**
 * CLIENTS PROPERS — the manual counterpart to arrival detection.
 *
 * Geofencing announces arrivals; this answers "what else is around here?".
 * It takes a single fix on demand, uses it to sort, and throws it away — the
 * position is never written anywhere, which is the difference between a working
 * tool and a tracker.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useSession } from '../../src/runtime/session';
import { Body, Button, Card, Empty, Faint, Label, Row, Screen, Title } from '../../src/ui/kit';
import { haversineMeters } from '@vitalpe/domain';
import { formatDistance } from '../../src/core/format';
import { space } from '../../src/core/theme';

export default function NearbyScreen() {
  const { ready, session, cache } = useSession();
  const router = useRouter();
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) return null;
  if (session === null) return <Redirect href="/entrar" />;

  async function locate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError("Sense permís d'ubicació no es pot ordenar per distància.");
        return;
      }
      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPosition({ latitude: fix.coords.latitude, longitude: fix.coords.longitude });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const located = cache.clients.filter((c) => c.latitude !== null && c.longitude !== null);
  const ranked =
    position === null
      ? located.slice(0, 40).map((c) => ({ client: c, meters: null as number | null }))
      : located
          .map((c) => ({
            client: c,
            meters: haversineMeters(position, {
              latitude: c.latitude as number,
              longitude: c.longitude as number,
            }),
          }))
          .sort((a, b) => a.meters - b.meters)
          .slice(0, 40);

  const pending = cache.clients.length - located.length;

  return (
    <Screen>
      <View>
        <Title>CLIENTS PROPERS</Title>
        <Faint>
          {located.length} amb coordenades
          {pending > 0 ? ` · ${pending} pendents de geolocalitzar` : ''}
        </Faint>
      </View>

      <Card>
        <Row>
          <Button variant="primary" onPress={() => void locate()} disabled={busy}>
            {busy ? 'LOCALITZANT…' : position === null ? 'ON SÓC' : 'ACTUALITZAR POSICIÓ'}
          </Button>
        </Row>
        {error !== null && <Faint>{error}</Faint>}
        {position !== null && (
          <Faint>La posició s&apos;usa només per ordenar aquesta llista. No es desa.</Faint>
        )}
      </Card>

      {ranked.length === 0 ? (
        <Empty>Cap client amb coordenades a la còpia local.</Empty>
      ) : (
        ranked.map(({ client, meters }) => (
          <Card key={client.id}>
            <Row>
              <Body>{client.name}</Body>
              {meters !== null && <Faint>{formatDistance(meters)}</Faint>}
            </Row>
            {client.municipality !== null && <Faint>{client.municipality}</Faint>}
            <View style={{ height: space.xs }} />
            <Button onPress={() => router.push(`/clients/${client.id}`)}>OBRIR FITXA</Button>
          </Card>
        ))
      )}
    </Screen>
  );
}
