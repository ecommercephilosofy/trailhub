/**
 * Local notifications for arrivals.
 *
 * These are LOCAL notifications, raised by the device itself when the OS wakes
 * the app for a geofence crossing. There is no push server and no remote token,
 * so nothing about the user's whereabouts ever leaves the phone to produce one.
 *
 * The payload is built by `src/core/notificationPayload.ts`, which is unit
 * tested to carry only IDs — never a company name — so a notification sitting
 * in a sync'd notification centre leaks nothing about who the user visits.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ARRIVAL_CHANNEL_ID, type LocalNotification } from '../core/notificationPayload';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Asks for permission and creates the Android channel.
 * Returns false when the user said no — the caller carries on regardless, since
 * a CRM that refuses to work without notifications would be worse than one
 * that simply cannot announce arrivals.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ARRIVAL_CHANNEL_ID, {
      name: 'Arribades a clients',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
      vibrationPattern: [0, 200],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (current.canAskAgain === false) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/** Shows an arrival notification immediately. */
export async function present(notification: LocalNotification): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: notification.title,
      body: notification.body,
      data: notification.data as unknown as Record<string, unknown>,
      sound: false,
    },
    // null = deliver now. The geofence has already fired; a delay would make
    // the notification arrive after the user has walked in.
    trigger: null,
  });
}

export async function cancelAllNotifications(): Promise<void> {
  await Notifications.dismissAllNotificationsAsync();
  await Notifications.cancelAllScheduledNotificationsAsync();
}
