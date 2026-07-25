/**
 * AVUI — what has to happen today, and the state of arrival watching.
 *
 * The screen redirects to sign-in when there is no session. It reads from the
 * offline cache, so it renders on a phone with no signal; refreshing is a pull
 * away and is the only thing that needs the network.
 */
import { useEffect, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '../src/runtime/session';
import { Body, Button, Card, Chip, Empty, Faint, Label, Row, Screen, Title } from '../src/ui/kit';
import { formatTimeRange, formatDate, relativeDays, isSameDay } from '../src/core/format';
import { toneFor, TASK_TONE, VISIT_TONE, space } from '../src/core/theme';
import { visitsOn } from '../src/core/cache';
import { locationPermissionState, type LocationPermissionState } from '../src/runtime/geofencing';
import { loadRegions } from '../src/runtime/storage';
import { ensureNotificationPermission } from '../src/runtime/notifications';

export default function AvuiScreen() {
  const { ready, session, cache, refresh, refreshing, lastError, signOut } = useSession();
  const router = useRouter();
  const [permissions, setPermissions] = useState<LocationPermissionState | null>(null);
  const [watching, setWatching] = useState(0);

  useEffect(() => {
    if (session === null) return;
    void (async () => {
      setPermissions(await locationPermissionState());
      setWatching((await loadRegions()).length);
      await ensureNotificationPermission();
    })();
  }, [session, cache.savedAt]);

  if (!ready) return null;
  if (session === null) return <Redirect href="/entrar" />;

  const now = new Date();
  const today = visitsOn(cache.visits, now, isSameDay);
  const overdue = cache.tasks.filter(
    (t) => t.dueAt !== null && Date.parse(t.dueAt) < now.getTime() && t.status === 'PENDENT',
  );

  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
      {lastError !== null && (
        <Card>
          <Label>SENSE CONNEXIÓ</Label>
          <Faint>
            Es mostra la còpia local desada el {formatDate(cache.savedAt)}. {lastError}
          </Faint>
        </Card>
      )}

      {permissions !== null && !permissions.background && (
        <Card>
          <Label>AVISOS D&apos;ARRIBADA DESACTIVATS</Label>
          <Body soft>
            Sense el permís d&apos;ubicació «Sempre» no et podem avisar quan arribis a un client
            amb l&apos;app tancada. La resta del CRM funciona igual.
          </Body>
          <View style={{ height: space.xs }} />
          <Button onPress={() => router.push('/permisos-ubicacio')}>ACTIVAR AVISOS</Button>
        </Card>
      )}

      <View>
        <Label>VISITES D&apos;AVUI ({today.length})</Label>
        {today.length === 0 ? (
          <Empty>Cap visita programada per avui.</Empty>
        ) : (
          today.map((visit) => (
            <Card key={visit.id} style={{ marginTop: space.sm }}>
              <Row>
                <Title>{visit.clientName}</Title>
                <Chip tone={toneFor(VISIT_TONE, visit.status)}>{visit.status}</Chip>
              </Row>
              <Faint>{formatTimeRange(visit.startsAt, visit.endsAt)}</Faint>
              {visit.objective !== null && <Body soft>{visit.objective}</Body>}
              <View style={{ height: space.xs }} />
              <Row>
                <Button onPress={() => router.push(`/clients/${visit.clientId}`)}>FITXA</Button>
                <Button
                  onPress={() => router.push(`/clients/${visit.clientId}/visits/${visit.id}`)}
                >
                  VISITA
                </Button>
              </Row>
            </Card>
          ))
        )}
      </View>

      <View>
        <Label>TASQUES VENÇUDES ({overdue.length})</Label>
        {overdue.length === 0 ? (
          <Empty>Res vençut.</Empty>
        ) : (
          overdue.slice(0, 20).map((task) => (
            <Card key={task.id} style={{ marginTop: space.sm }}>
              <Row>
                <Body>{task.clientName ?? 'Sense empresa'}</Body>
                <Chip tone={toneFor(TASK_TONE, task.priority)}>{task.priority}</Chip>
              </Row>
              <Faint>
                {task.action} · {relativeDays(task.dueAt, now)}
              </Faint>
              {task.clientId !== null && (
                <>
                  <View style={{ height: space.xs }} />
                  <Button onPress={() => router.push(`/clients/${task.clientId}`)}>OBRIR</Button>
                </>
              )}
            </Card>
          ))
        )}
      </View>

      <Card>
        <Label>VIGILÀNCIA D&apos;ARRIBADES</Label>
        <Faint>
          {watching} {watching === 1 ? 'client vigilat' : 'clients vigilats'} · {cache.clients.length}{' '}
          a la còpia local
        </Faint>
        <View style={{ height: space.xs }} />
        <Row>
          <Button onPress={() => router.push('/clients')}>CLIENTS PROPERS</Button>
          <Button variant="danger" onPress={() => void signOut()}>
            SORTIR
          </Button>
        </Row>
      </Card>
    </Screen>
  );
}
