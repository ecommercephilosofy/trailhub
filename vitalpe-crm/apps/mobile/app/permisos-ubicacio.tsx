/**
 * The location-permission explainer.
 *
 * iOS shows the "Always" prompt exactly once, and a user who declines it there
 * cannot be asked again from inside the app. So the ask is earned first: this
 * screen says plainly what is collected, what is not, and what stops working
 * without it — and only then triggers the system dialog.
 *
 * Refusing is a supported outcome, not an error state. The CRM keeps working;
 * only the automatic arrival notice is lost.
 */
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Body, Button, Card, Faint, Label, Row, Screen, Title } from '../src/ui/kit';
import {
  locationPermissionState,
  requestLocationPermissions,
  syncGeofences,
  type LocationPermissionState,
} from '../src/runtime/geofencing';
import { ensureNotificationPermission } from '../src/runtime/notifications';
import { space } from '../src/core/theme';

export default function LocationPermissionScreen() {
  const router = useRouter();
  const [state, setState] = useState<LocationPermissionState | null>(null);
  const [notifications, setNotifications] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void locationPermissionState().then(setState);
  }, []);

  async function grant(): Promise<void> {
    setBusy(true);
    try {
      const next = await requestLocationPermissions();
      setState(next);
      setNotifications(await ensureNotificationPermission());
      // Arming the regions immediately is the proof the permission worked;
      // waiting for the next refresh would leave the user unsure.
      if (next.background) await syncGeofences(new Date());
    } finally {
      setBusy(false);
    }
  }

  const granted = state?.background === true;

  return (
    <Screen>
      <View>
        <Title>AVISAR-ME QUAN ARRIBI</Title>
        <Faint>Per avisar-te amb l&apos;app tancada, Android i iOS demanen un permís concret.</Faint>
      </View>

      <Card>
        <Label>QUÈ ES GUARDA</Label>
        <Body>
          Només el fet d&apos;haver arribat a un client: quin, quan, i si has obert la fitxa.
        </Body>
        <View style={{ height: space.xs }} />
        <Label>QUÈ NO ES GUARDA</Label>
        <Body>
          Cap recorregut. La teva posició no s&apos;envia enlloc; el telèfon compara les
          coordenades amb la llista de clients i decideix ell mateix.
        </Body>
      </Card>

      <Card>
        <Label>ESTAT</Label>
        <Body>Ubicació en ús: {state?.foreground === true ? 'concedit' : 'no concedit'}</Body>
        <Body>Ubicació «Sempre»: {granted ? 'concedit' : 'no concedit'}</Body>
        {notifications === false && <Faint>Les notificacions estan desactivades al sistema.</Faint>}
      </Card>

      {granted ? (
        <Card>
          <Label>ACTIVAT</Label>
          <Body>Ja et podem avisar en arribar a un client.</Body>
          <View style={{ height: space.xs }} />
          <Button variant="primary" onPress={() => router.back()}>
            FET
          </Button>
        </Card>
      ) : (
        <Card>
          <Row>
            <Button variant="primary" onPress={() => void grant()} disabled={busy}>
              {busy ? 'DEMANANT…' : 'DEMANAR EL PERMÍS'}
            </Button>
            {state?.canAskBackground === false && (
              <Button onPress={() => void Linking.openSettings()}>OBRIR AJUSTOS</Button>
            )}
          </Row>
          {state?.canAskBackground === false && (
            <Faint>
              El sistema ja no permet tornar-ho a demanar des de l&apos;app: cal activar-ho a
              Ajustos → Vitalpe → Ubicació → Sempre.
            </Faint>
          )}
          <Faint>Pots dir que no: la resta del CRM funciona igual.</Faint>
        </Card>
      )}
    </Screen>
  );
}
