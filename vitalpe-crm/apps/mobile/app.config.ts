import type { ExpoConfig } from 'expo/config';

/**
 * Expo configuration for the VITALPE field app.
 *
 * Two things here are load-bearing and must not be "tidied up":
 *
 *  1. Background geofencing. It needs `UIBackgroundModes: ['location']` plus
 *     BOTH iOS location strings on iOS, and ACCESS_BACKGROUND_LOCATION on
 *     Android. None of it works in Expo Go — see docs/MOBILE_SETUP.md.
 *  2. The deep links. `/clients/:id` and `/clients/:id/visits/:id` are opened
 *     from arrival notifications and from Google Calendar events, so the same
 *     two paths are declared three times: as the custom scheme, as iOS
 *     associated domains and as Android App Links.
 */

/** Host that serves /.well-known/apple-app-site-association and assetlinks.json. */
const APP_HOST = process.env.EXPO_PUBLIC_APP_HOST ?? 'crm.vitalpe.cat';

const BUNDLE_ID = process.env.EXPO_PUBLIC_BUNDLE_ID ?? 'cat.vitalpe.crm';

const config: ExpoConfig = {
  name: 'Vitalpe',
  slug: 'vitalpe-crm',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'vitalpe',
  userInterfaceStyle: 'light',
  backgroundColor: '#faf7f2',
  primaryColor: '#6b1230',
  assetBundlePatterns: ['**/*'],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    appHost: APP_HOST,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3004',
    eas: {
      projectId: process.env.EXPO_PROJECT_ID ?? '',
    },
  },

  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    // Universal Links for /clients/:id and /clients/:id/visits/:id.
    associatedDomains: [`applinks:${APP_HOST}`],
    infoPlist: {
      // Shown the first time we ask, while the app is in the foreground.
      NSLocationWhenInUseUsageDescription:
        "L'app utilitza la teva posició per mostrar els clients que tens a prop. La posició no es desa enlloc.",
      // Shown only after the explanatory screen (app/permisos-ubicacio.tsx).
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Amb el permís «Sempre» l'app t'avisa quan arribes a un client, encara que no la tinguis oberta. Només es desa el fet d'haver arribat, mai un recorregut.",
      NSLocationAlwaysUsageDescription:
        "Amb el permís «Sempre» l'app t'avisa quan arribes a un client, encara que no la tinguis oberta. Només es desa el fet d'haver arribat, mai un recorregut.",
      NSMicrophoneUsageDescription:
        'El micròfon serveix per dictar notes de veu al registre ràpid.',
      // Region monitoring wakes the app in the background.
      UIBackgroundModes: ['location'],
      ITSAppUsesNonExemptEncryption: false,
    },
    entitlements: {
      'com.apple.developer.associated-domains': [`applinks:${APP_HOST}`],
    },
  },

  android: {
    package: BUNDLE_ID,
    // Edge-to-edge is the platform default from SDK 54 on; the old opt-in flag
    // was removed from the config type, so setting it fails the type check.
    adaptiveIcon: {
      backgroundColor: '#faf7f2',
    },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'POST_NOTIFICATIONS',
      'RECORD_AUDIO',
      'VIBRATE',
      'RECEIVE_BOOT_COMPLETED',
      'WAKE_LOCK',
    ],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: APP_HOST, pathPrefix: '/clients' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          "Amb el permís «Sempre» l'app t'avisa quan arribes a un client, encara que no la tinguis oberta.",
        locationWhenInUsePermission:
          "L'app utilitza la teva posició per mostrar els clients que tens a prop.",
        // Region monitoring only. We never start continuous updates, so no
        // background location indicator is requested beyond the geofence.
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: false,
      },
    ],
    [
      'expo-notifications',
      {
        color: '#6b1230',
      },
    ],
    [
      'expo-audio',
      {
        microphonePermission: 'El micròfon serveix per dictar notes de veu al registre ràpid.',
      },
    ],
    [
      'expo-build-properties',
      {
        // This SDK refuses anything below 16.4; the old 15.1 made every config
        // resolution fail, which is why it never got as far as a build.
        ios: { deploymentTarget: '16.4' },
        android: { minSdkVersion: 24, compileSdkVersion: 35, targetSdkVersion: 35 },
      },
    ],
  ],
};

export default config;
