/**
 * The Supabase client for the phone.
 *
 * `src/core/` is pure and testable; everything in `src/runtime/` is the part
 * that touches a device API and therefore cannot run in a unit test. Keeping
 * the split visible is what stops device concerns leaking into the rules.
 *
 * The session is persisted in the secure enclave (Keychain / Keystore) rather
 * than AsyncStorage: a refresh token in plain shared preferences is readable by
 * anything with filesystem access on a rooted device.
 */
import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiUrl?: string;
  appHost?: string;
};

export const SUPABASE_URL = extra.supabaseUrl ?? '';
export const SUPABASE_ANON_KEY = extra.supabaseAnonKey ?? '';
export const API_URL = extra.apiUrl ?? '';
export const APP_HOST = extra.appHost ?? 'crm.vitalpe.cat';

/** True when the build carries the credentials it needs to talk to the CRM. */
export function isConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

/**
 * SecureStore has a ~2 KB practical limit per item on iOS and refuses keys with
 * dots on some platforms, so the adapter namespaces with underscores and
 * chunks nothing: a Supabase session is well under the limit.
 */
const secureAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key.replace(/[^\w.-]/g, '_')),
  setItem: (key: string, value: string) =>
    SecureStore.setItemAsync(key.replace(/[^\w.-]/g, '_'), value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key.replace(/[^\w.-]/g, '_')),
};

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (client === null) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: secureAdapter,
        // The phone keeps the user signed in; the web app does not (it has its
        // own cookie). Detecting a session in a URL is a browser concern and
        // would misfire on a deep link.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}
