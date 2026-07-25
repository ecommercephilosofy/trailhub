/**
 * The company card — what an arrival notification opens.
 *
 * This is the screen the whole geofencing feature exists to reach, so it has to
 * survive being opened cold, offline, and with nothing but an id: it reads the
 * offline cache first and only then asks the network. A card that showed a
 * spinner because the phone is in a cellar would defeat the point.
 */
import { useEffect, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../../../src/runtime/session';
import { Body, Button, Card, Chip, Empty, Faint, Label, Row, Screen, Title } from '../../../src/ui/kit';
import { formatDate, formatTimeRange } from '../../../src/core/format';
import { CLASSIFICATION_TONE, toneFor, space } from '../../../src/core/theme';
import { isUuid } from '../../../src/core/deepLinks';
import { fetchClient } from '../../../src/runtime/api';
import { markRejected } from '../../../src/runtime/storage';
import type { CachedClient } from '../../../src/core/cache';

export default function ClientCardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready, session, cache } = useSession();
  const router = useRouter();
  const [fetched, setFetched] = useState<CachedClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);

  const clientId = typeof id === 'string' ? id.toLowerCase() : '';
  const cached = useMemo(
    () => cache.clients.find((c) => c.id === clientId) ?? null,
    [cache.clients, clientId],
  );
  const client = cached ?? fetched;

  useEffect(() => {
    // Only reach for the network when the cache could not answer.
    if (cached !== null || !isUuid(clientId) || session === null) return;
    let alive = true;
    void fetchClient(clientId)
      .then((row) => {
        if (alive) setFetched(row);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [cached, clientId, session]);

  if (!ready) return null;
  if (session === null) return <Redirect href="/entrar" />;

  if (!isUuid(clientId)) {
    return (
      <Screen>
        <Card>
          <Label>ENLLAÇ NO VÀLID</Label>
          <Body soft>Aquesta adreça no correspon a cap fitxa.</Body>
        </Card>
      </Screen>
    );
  }

  const visits = cache.visits
    .filter((v) => v.clientId === clientId && v.status !== 'CANCEL·LADA')
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const nextVisit = visits.find((v) => Date.parse(v.startsAt) >= Date.now()) ?? null;
  const tasks = cache.tasks.filter((t) => t.clientId === clientId && t.status === 'PENDENT');

  return (
    <Screen>
      {client === null ? (
        <Card>
          <Label>{error === null ? 'CARREGANT…' : 'NO DISPONIBLE'}</Label>
          <Body soft>
            {error === null
              ? 'Aquesta empresa no és a la còpia local; s’està consultant al servidor.'
              : `No s’ha pogut carregar la fitxa: ${error}`}
          </Body>
        </Card>
      ) : (
        <>
          <View>
            <Title>{client.name}</Title>
            <Faint>{client.municipality ?? 'Sense municipi'}</Faint>
            <View style={{ height: space.xs }} />
            <Row>
              {client.classification !== null && (
                <Chip tone={toneFor(CLASSIFICATION_TONE, client.classification)}>
                  {client.classification}
                </Chip>
              )}
              {client.latitude === null && <Chip tone="avis">PENDENT DE GEOLOCALITZAR</Chip>}
            </Row>
          </View>

          <Card>
            <Label>ACCIONS</Label>
            <Row>
              {client.phone !== null && (
                <Button onPress={() => void Linking.openURL(`tel:${client.phone}`)}>TRUCAR</Button>
              )}
              {client.email !== null && (
                <Button onPress={() => void Linking.openURL(`mailto:${client.email}`)}>
                  CORREU
                </Button>
              )}
              <Button
                variant="primary"
                onPress={() => router.push(`/registre?client=${clientId}`)}
              >
                NOTA DE VEU
              </Button>
              {client.latitude !== null && client.longitude !== null && (
                <Button
                  onPress={() =>
                    void Linking.openURL(
                      `https://www.google.com/maps/search/?api=1&query=${client.latitude},${client.longitude}`,
                    )
                  }
                >
                  MAPA
                </Button>
              )}
            </Row>
          </Card>

          <Card>
            <Label>PROPERA VISITA</Label>
            {nextVisit === null ? (
              <Empty>Cap visita programada.</Empty>
            ) : (
              <>
                <Body>{formatDate(nextVisit.startsAt)}</Body>
                <Faint>{formatTimeRange(nextVisit.startsAt, nextVisit.endsAt)}</Faint>
                <View style={{ height: space.xs }} />
                <Button
                  onPress={() => router.push(`/clients/${clientId}/visits/${nextVisit.id}`)}
                >
                  OBRIR VISITA
                </Button>
              </>
            )}
          </Card>

          <Card>
            <Label>TASQUES PENDENTS ({tasks.length})</Label>
            {tasks.length === 0 ? (
              <Empty>Res pendent.</Empty>
            ) : (
              tasks.slice(0, 10).map((task) => (
                <View key={task.id} style={{ paddingVertical: 2 }}>
                  <Body>{task.action}</Body>
                  <Faint>{task.dueAt === null ? 'Sense data' : formatDate(task.dueAt)}</Faint>
                </View>
              ))
            )}
          </Card>

          {/*
            Arriving at the wrong company is normal in an industrial estate.
            Saying so silences this company for a while instead of training the
            user to ignore every arrival notification.
          */}
          <Card>
            <Label>NO ETS AQUÍ?</Label>
            {rejected ? (
              <Faint>Anotat: no tornarem a avisar d&apos;aquesta empresa durant un temps.</Faint>
            ) : (
              <>
                <Body soft>
                  Si l&apos;avís d&apos;arribada s&apos;ha equivocat, digues-ho i deixarem de
                  suggerir aquesta empresa en aquest punt.
                </Body>
                <View style={{ height: space.xs }} />
                <Button
                  onPress={() => {
                    void markRejected(clientId, new Date());
                    setRejected(true);
                  }}
                >
                  NO ÉS AQUEST CLIENT
                </Button>
              </>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}
