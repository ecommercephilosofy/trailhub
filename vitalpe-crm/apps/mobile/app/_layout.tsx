/**
 * Root layout: session gate, and the routing of an arrival notification.
 *
 * Two things here are load-bearing:
 *
 *  1. `src/runtime/geofencing` is imported for its SIDE EFFECT. Importing it
 *     runs `TaskManager.defineTask` at module scope, which is the only way the
 *     task exists when the OS cold-boots the app for a region crossing.
 *
 *  2. A notification is handled through TWO paths, because they are genuinely
 *     different events: `getLastNotificationResponseAsync()` covers the tap
 *     that STARTED the process (cold start — the listener has not been attached
 *     yet and would miss it), and the listener covers taps while the app is
 *     alive. Implement only one and the feature works in testing and fails on a
 *     phone that had been closed.
 *
 * Every route that arrives from outside is validated by `isSafeInAppRoute`
 * before it is navigated to: a notification payload is data, not a command.
 */
import { useEffect, useRef } from 'react';
import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '../src/runtime/session';
import { isSafeInAppRoute, parseDeepLink } from '../src/core/deepLinks';
import { APP_HOST } from '../src/runtime/supabase';
import { colors } from '../src/core/theme';
// Side-effect import: defines the background geofence task. Do not remove.
import '../src/runtime/geofencing';

function useNotificationRouting(): void {
  const router = useRouter();
  // A cold-start tap and the listener can both fire for the same tap; the guard
  // keeps the app from pushing the same card twice.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;

    const go = (raw: unknown): void => {
      const route = typeof raw === 'string' ? raw : null;
      if (route === null || !isSafeInAppRoute(route)) return;
      if (handled.current === route) return;
      handled.current = route;
      router.push(route as never);
    };

    // 1 — the tap that started the process (cold start).
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!alive || !response) return;
      go(response.notification.request.content.data?.route);
    });

    // 2 — taps while the app is running or backgrounded.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      go(response.notification.request.content.data?.route);
    });

    // 3 — Universal Links / App Links / custom scheme, from outside.
    const openUrl = (url: string | null): void => {
      const target = parseDeepLink(url, { allowedHosts: [APP_HOST] });
      if (target) go(target.route);
    };
    void Linking.getInitialURL().then((url) => {
      if (alive) openUrl(url);
    });
    const linkSub = Linking.addEventListener('url', (event) => openUrl(event.url));

    return () => {
      alive = false;
      sub.remove();
      linkSub.remove();
    };
  }, [router]);
}

function Routes() {
  useNotificationRouting();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.paper },
        headerTintColor: colors.burgundy,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: colors.paper },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'AVUI' }} />
      <Stack.Screen name="entrar" options={{ title: 'ACCÉS', headerShown: false }} />
      <Stack.Screen name="arribada" options={{ title: 'ON ETS?' }} />
      <Stack.Screen name="permisos-ubicacio" options={{ title: 'PERMISOS' }} />
      <Stack.Screen name="clients/index" options={{ title: 'CLIENTS PROPERS' }} />
      <Stack.Screen name="clients/[id]/index" options={{ title: 'FITXA' }} />
      <Stack.Screen name="clients/[id]/visits/[visitId]" options={{ title: 'VISITA' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Routes />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
