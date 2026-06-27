import { supabase } from './supabase';
import { getPersistedSession } from './db';

export async function hydrateSession(): Promise<boolean> {
  try {
    // 1. Читаем сессию из локальной SQLite базы (Rust)
    const localSession = await getPersistedSession();
    
    if (!localSession) {
      console.log('[Auth Hydrator] No local session found');
      return false;
    }

    console.log('[Auth Hydrator] Local session found, restoring to Supabase...');

    // 2. Восстанавливаем сессию в Supabase клиенте
    const { data, error } = await supabase.auth.setSession({
      access_token: localSession.access_token,
      refresh_token: localSession.refresh_token,
    });

    if (error) {
      console.error('[Auth Hydrator] Failed to restore session:', error);
      return false;
    }

    console.log('[Auth Hydrator] Session restored successfully!');
    return true;
  } catch (err) {
    console.error('[Auth Hydrator] Hydration failed:', err);
    return false;
  }
}