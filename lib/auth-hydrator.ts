import { supabase } from './supabase'

/**
 * Supabase сам хранит сессию в localStorage (persistSession: true).
 * При загрузке просто проверяем, есть ли активная сессия.
 * Восстановление происходит автоматически.
 */
export async function hydrateSession(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      console.log('[Auth] Session active:', session.user.id)
      return true
    }
    
    // Если сессии нет — пробуем рефреш (сработает если есть refresh_token в localStorage)
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data.session) {
      console.log('[Auth] No session')
      return false
    }
    
    console.log('[Auth] Session refreshed:', data.session.user.id)
    return true
  } catch (err) {
    console.error('[Auth] Hydrate error:', err)
    return false
  }
}
