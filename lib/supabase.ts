// Переход на нативную SQLite вместо localStorage.
// Файл-мост: экспортирует supabase-клиент + функции сессий из db.ts

import { getSupabase as _getSupabase, getPersistedSession, persistSession, terminateSession, generateHWID, getDevices, deleteDevice, getLocalAccount, saveLocalAccount, ensureAuth } from './db'

// Экспортируем инстанс клиента (не функцию!) для обратной совместимости
export const supabase = _getSupabase()

// Реэкспорт функций
export { getSupabase, getPersistedSession, persistSession, terminateSession, generateHWID, getDevices, deleteDevice, getLocalAccount, saveLocalAccount, ensureAuth, ensureSupabaseSessionFresh } from './db'
