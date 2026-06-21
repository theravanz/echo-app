import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    headers: {
      'X-Client-Info': 'echo-messenger',
    },
  },
})

// === ХЕЛПЕР ДЛЯ ПРИНУДИТЕЛЬНОГО ОБНОВЛЕНИЯ ===
export const ensureAuth = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session) {
    // Пробуем обновить
    const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
    if (error || !refreshed) {
      throw new Error('No valid session');
    }
    return refreshed;
  }
  
  // Проверяем, жив ли токен (делаем тестовый запрос)
  try {
    const test = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${session.access_token}`
      }
    });
    if (test.status === 401) {
      // Токен протух — обновляем
      const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
      if (error || !refreshed) {
        throw new Error('Cannot refresh token');
      }
      return refreshed;
    }
  } catch (e) {
    // Если тестовый запрос упал — пробуем обновить
    const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
    if (error || !refreshed) {
      throw new Error('Cannot refresh token');
    }
    return refreshed;
  }
  
  return session;
};