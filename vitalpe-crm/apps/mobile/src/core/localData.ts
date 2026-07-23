/**
 * Signing out wipes the device.
 *
 * A phone is lost, lent, sold or handed to a colleague. Whatever this app left
 * behind — the session tokens, the cached client list, the audio of a note
 * dictated in a car, the regions the OS is still watching — is customer data
 * belonging to Vitalpe, so SORTIR removes all of it rather than only forgetting
 * the token.
 *
 * Two design points worth defending:
 *
 *   1. Every store is attempted even if an earlier one throws. A failing cache
 *      clear must never be the reason a refresh token survives on the device.
 *   2. The tokens go LAST. If the process is killed mid-wipe, the next launch
 *      still has a session and can finish the job; the reverse would leave
 *      orphan data with no way to reach it.
 *
 * Pure module: the stores are injected, so this runs in a test with fakes and
 * in the app with `expo-secure-store` / AsyncStorage / expo-file-system.
 */

/** Every key this app ever writes to the secure store. */
export const SECURE_STORE_KEYS = [
  'vitalpe.auth.session',
  'vitalpe.auth.refresh',
  'vitalpe.auth.user',
  'vitalpe.device.key',
  'vitalpe.workspace.id',
] as const;
export type SecureStoreKey = (typeof SECURE_STORE_KEYS)[number];

export interface SecureStoreLike {
  deleteItem(key: string): Promise<void>;
}
export interface KeyValueStoreLike {
  /** Removes every cached list, setting and queue entry. */
  clear(): Promise<void>;
}
export interface FileStoreLike {
  /** Deletes the voice-note directory and everything in it. */
  deleteVoiceRecordings(): Promise<void>;
}
export interface GeofencingLike {
  /** Stops every monitored region. Must not need a session. */
  unregisterAll(): Promise<void>;
}
export interface NotificationsLike {
  /** Clears anything already shown or scheduled. */
  cancelAll(): Promise<void>;
}

export interface LocalStores {
  secure: SecureStoreLike;
  kv: KeyValueStoreLike;
  files: FileStoreLike;
  geofencing: GeofencingLike;
  notifications: NotificationsLike;
}

export interface WipeReport {
  secureKeysDeleted: string[];
  kvCleared: boolean;
  recordingsDeleted: boolean;
  regionsUnregistered: boolean;
  notificationsCancelled: boolean;
  /** Human-readable failures, in the order they happened. Empty = clean wipe. */
  failures: string[];
  /** False when anything that holds user data survived. */
  complete: boolean;
}

async function attempt(
  label: string,
  failures: string[],
  fn: () => Promise<void>,
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Removes every trace of the signed-in user from the device.
 * Never throws: the caller gets a report and decides what to tell the user.
 */
export async function wipeLocalData(stores: LocalStores): Promise<WipeReport> {
  const failures: string[] = [];

  const regionsUnregistered = await attempt('GEOFENCES', failures, () =>
    stores.geofencing.unregisterAll(),
  );
  const notificationsCancelled = await attempt('NOTIFICACIONS', failures, () =>
    stores.notifications.cancelAll(),
  );
  const recordingsDeleted = await attempt('AUDIO', failures, () =>
    stores.files.deleteVoiceRecordings(),
  );
  const kvCleared = await attempt('CACHE', failures, () => stores.kv.clear());

  // Tokens last: see the header note.
  const secureKeysDeleted: string[] = [];
  for (const key of SECURE_STORE_KEYS) {
    const ok = await attempt(`SECURE ${key}`, failures, () => stores.secure.deleteItem(key));
    if (ok) secureKeysDeleted.push(key);
  }

  return {
    secureKeysDeleted,
    kvCleared,
    recordingsDeleted,
    regionsUnregistered,
    notificationsCancelled,
    failures,
    complete:
      failures.length === 0 && secureKeysDeleted.length === SECURE_STORE_KEYS.length,
  };
}

/**
 * What the user would lose by signing out right now. The sign-out screen shows
 * this BEFORE wiping, because "3 notes de veu encara no pujades" is the kind of
 * thing you want to know one second earlier, not one second later.
 */
export interface UnsyncedSummary {
  pendingOperations: number;
  pendingVoiceNotes: number;
  blocked: number;
  hasAnything: boolean;
}

export function summariseUnsynced(
  queue: readonly { status: string; operation: string }[],
): UnsyncedSummary {
  let pendingOperations = 0;
  let pendingVoiceNotes = 0;
  let blocked = 0;
  for (const entry of queue) {
    if (entry.status === 'ERROR' || entry.status === 'CONFLICTE') {
      blocked += 1;
      continue;
    }
    if (entry.status !== 'PENDENT') continue;
    if (entry.operation === 'CREAR_NOTA_VEU' || entry.operation === 'PUJAR_AUDIO') {
      pendingVoiceNotes += 1;
    } else {
      pendingOperations += 1;
    }
  }
  return {
    pendingOperations,
    pendingVoiceNotes,
    blocked,
    hasAnything: pendingOperations + pendingVoiceNotes + blocked > 0,
  };
}
