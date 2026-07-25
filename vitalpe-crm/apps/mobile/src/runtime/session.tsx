/**
 * Who is signed in, and the working set that follows from it.
 *
 * One provider rather than a store library: the phone has exactly one session,
 * one cache and one region plan, and a context makes the dependency between
 * them explicit — signing out has to stop the geofences, not merely forget the
 * user.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isConfigured, supabase } from './supabase';
import { fetchWorkingSet } from './api';
import { loadCache, saveCache, clearAllLocalState } from './storage';
import { stopGeofencing, syncGeofences } from './geofencing';
import { cancelAllNotifications } from './notifications';
import type { OfflineCache } from '../core/cache';
import { emptyCache } from '../core/cache';

interface SessionState {
  ready: boolean;
  session: Session | null;
  configured: boolean;
  cache: OfflineCache;
  refreshing: boolean;
  lastError: string | null;
  signIn(email: string, password: string): Promise<{ ok: boolean; error?: string }>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const value = useContext(Ctx);
  if (value === null) throw new Error('useSession fora del SessionProvider');
  return value;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [cache, setCache] = useState<OfflineCache>(() => emptyCache(new Date()));
  const [refreshing, setRefreshing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const configured = isConfigured();

  useEffect(() => {
    let alive = true;
    (async () => {
      // The cache loads first and unconditionally: the app must show yesterday's
      // visits on a train with no signal, before any network call is attempted.
      const stored = await loadCache(new Date());
      if (alive) setCache(stored);

      if (configured) {
        const { data } = await supabase().auth.getSession();
        if (alive) setSession(data.session);
      }
      if (alive) setReady(true);
    })();

    if (!configured) return () => { alive = false; };
    const { data: sub } = supabase().auth.onAuthStateChange((_event, next) => {
      if (alive) setSession(next);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [configured]);

  const refresh = useCallback(async () => {
    if (!configured || session === null) return;
    setRefreshing(true);
    setLastError(null);
    try {
      const now = new Date();
      const working = await fetchWorkingSet(now);
      const next: OfflineCache = {
        ...cache,
        version: cache.version,
        savedAt: now.toISOString(),
        clients: working.clients,
        visits: working.visits,
        tasks: working.tasks,
        settings: working.settings,
      };
      await saveCache(next);
      setCache(next);
      // Regions are re-planned from the cache we just wrote, so the phone never
      // monitors a company it can no longer describe.
      await syncGeofences(now);
    } catch (error) {
      setLastError((error as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [cache, configured, session]);

  // Refresh once when a session appears.
  useEffect(() => {
    if (ready && session !== null) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, session?.user.id]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!configured) return { ok: false, error: 'Aquesta versió no té la connexió configurada.' };
      const { error } = await supabase().auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) return { ok: false, error: 'Correu o contrasenya incorrectes.' };
      return { ok: true };
    },
    [configured],
  );

  const signOut = useCallback(async () => {
    // Order matters: stop watching the world BEFORE forgetting who we are.
    // A geofence left armed after sign-out would raise a notification naming a
    // company the next person to hold the phone has no right to see.
    await stopGeofencing();
    await cancelAllNotifications();
    await clearAllLocalState();
    setCache(emptyCache(new Date()));
    if (configured) await supabase().auth.signOut();
    setSession(null);
  }, [configured]);

  const value = useMemo<SessionState>(
    () => ({ ready, session, configured, cache, refreshing, lastError, signIn, signOut, refresh }),
    [ready, session, configured, cache, refreshing, lastError, signIn, signOut, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
